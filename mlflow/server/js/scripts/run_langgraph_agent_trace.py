#!/usr/bin/env python3
"""Run a LangGraph ReAct agent and log its trace to an MLflow tracking server.

Prerequisites:
  export OPENAI_API_KEY=...
  mlflow server --host 127.0.0.1 --port 5005

Example:
  python scripts/run_langgraph_agent_trace.py \
    "What is the weather in Tokyo, and what is 42 * 7 + 3?"
"""

import argparse
import ast
import operator
import os
import sys
from pathlib import Path
from typing import Any


def _add_repo_root_to_path() -> None:
    """Prefer this checkout's MLflow package when the script runs inside the repo."""
    for parent in Path(__file__).resolve().parents:
        if (parent / "mlflow").is_dir() and (parent / "pyproject.toml").is_file():
            sys.path.insert(0, str(parent))
            return


_add_repo_root_to_path()

import mlflow  # noqa: E402
from mlflow.entities import SpanType  # noqa: E402


DEFAULT_TRACKING_URI = "http://localhost:5005"
DEFAULT_EXPERIMENT_NAME = "langgraph-react-agent-demo"
DEFAULT_PROMPT = "What is the weather in Tokyo, list some Asian capitals, and calculate 42 * 7 + 3."

_BINARY_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY_OPERATORS = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}


def _eval_arithmetic(node: ast.AST) -> int | float:
    if isinstance(node, ast.Expression):
        return _eval_arithmetic(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _BINARY_OPERATORS:
        return _BINARY_OPERATORS[type(node.op)](
            _eval_arithmetic(node.left),
            _eval_arithmetic(node.right),
        )
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPERATORS:
        return _UNARY_OPERATORS[type(node.op)](_eval_arithmetic(node.operand))
    raise ValueError("Only basic arithmetic expressions are supported.")


def evaluate_basic_arithmetic(expression: str) -> str:
    try:
        return str(_eval_arithmetic(ast.parse(expression, mode="eval")))
    except Exception as e:
        return f"Error evaluating expression: {e}"


def configure_mlflow(tracking_uri: str, experiment_name: str):
    mlflow.set_tracking_uri(tracking_uri)
    experiment = mlflow.set_experiment(experiment_name)

    try:
        mlflow.langchain.autolog(log_traces=True, run_tracer_inline=True)
    except TypeError:
        mlflow.langchain.autolog(log_traces=True)

    return experiment


def build_agent(model: str, temperature: float):
    # These imports intentionally happen after mlflow.langchain.autolog().
    from langchain_core.tools import tool
    from langchain_openai import ChatOpenAI
    from langgraph.prebuilt import create_react_agent

    @tool
    def get_weather(city: str) -> str:
        """Get the current weather for a given city (mocked for demo)."""
        weather_db = {
            "tokyo": "18 C, partly cloudy",
            "london": "12 C, overcast",
            "new york": "25 C, sunny",
            "paris": "16 C, light rain",
        }
        return weather_db.get(city.lower(), f"No weather data available for {city}.")

    @tool
    def calculate(expression: str) -> str:
        """Evaluate a basic arithmetic expression, e.g. '42 * 7 + 3'."""
        return evaluate_basic_arithmetic(expression)

    @tool
    def list_capitals(continent: str) -> str:
        """Return the capital cities of countries in a given continent (mocked)."""
        data = {
            "europe": "France->Paris, Germany->Berlin, Italy->Rome, Spain->Madrid",
            "asia": "Japan->Tokyo, China->Beijing, India->New Delhi, Korea->Seoul",
            "americas": "USA->Washington DC, Brazil->Brasilia, Canada->Ottawa",
        }
        return data.get(continent.lower(), f"No data for continent: {continent}")

    tools = [get_weather, calculate, list_capitals]
    llm = ChatOpenAI(model=model, temperature=temperature)
    agent = create_react_agent(llm, tools)
    return agent, tools


def extract_final_text(agent_result: dict[str, Any]) -> str:
    messages = agent_result.get("messages", [])
    if not messages:
        return str(agent_result)

    final_message = messages[-1]
    content = getattr(final_message, "content", None)
    return str(content if content is not None else final_message)


def run_agent(agent, prompt: str, model: str, tool_names: list[str], session_id: str, user: str) -> str:
    with mlflow.start_span(name="langgraph_react_agent", span_type=SpanType.AGENT) as span:
        span.set_inputs({"prompt": prompt})
        mlflow.update_current_trace(
            metadata={
                "mlflow.source.name": Path(__file__).name,
                "agent.model": model,
                "agent.tools": ",".join(tool_names),
            },
            request_preview=prompt,
            session_id=session_id,
            user=user,
        )

        result = agent.invoke(
            {"messages": [{"role": "user", "content": prompt}]},
            config={"configurable": {"thread_id": session_id}},
        )
        final_text = extract_final_text(result)

        span.set_outputs({"response": final_text})
        mlflow.update_current_trace(response_preview=final_text)
        return final_text


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a LangGraph ReAct agent and send traces to MLflow.",
    )
    parser.add_argument("prompt", nargs="?", default=DEFAULT_PROMPT)
    parser.add_argument(
        "--tracking-uri",
        default=os.environ.get("MLFLOW_TRACKING_URI", DEFAULT_TRACKING_URI),
        help=f"MLflow tracking URI. Defaults to {DEFAULT_TRACKING_URI}.",
    )
    parser.add_argument(
        "--experiment-name",
        default=os.environ.get("MLFLOW_EXPERIMENT_NAME", DEFAULT_EXPERIMENT_NAME),
    )
    parser.add_argument("--model", default=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"))
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--session-id", default="local-langgraph-demo")
    parser.add_argument("--user", default=os.environ.get("USER", "local-user"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not os.environ.get("OPENAI_API_KEY"):
        print("OPENAI_API_KEY is not set. Export it before running this script.", file=sys.stderr)
        return 2

    experiment = configure_mlflow(args.tracking_uri, args.experiment_name)
    agent, tools = build_agent(args.model, args.temperature)
    tool_names = [tool.name for tool in tools]

    print(f"MLflow tracking URI: {mlflow.get_tracking_uri()}")
    print(f"Experiment: {args.experiment_name} (ID: {experiment.experiment_id})")
    print(f"Agent ready with {len(tools)} tools: {tool_names}")
    print(f"Prompt: {args.prompt}")

    try:
        response = run_agent(agent, args.prompt, args.model, tool_names, args.session_id, args.user)
        print("\nFinal response:")
        print(response)

        if trace_id := mlflow.get_last_active_trace_id():
            trace_url_base = args.tracking_uri.rstrip("/")
            print(f"\nTrace ID: {trace_id}")
            print(f"Trace UI: {trace_url_base}/#/experiments/{experiment.experiment_id}/traces")
        return 0
    finally:
        if flush_trace_async_logging := getattr(mlflow, "flush_trace_async_logging", None):
            flush_trace_async_logging(terminate=True)


if __name__ == "__main__":
    raise SystemExit(main())
