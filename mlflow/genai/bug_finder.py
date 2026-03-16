from __future__ import annotations

import inspect
import logging
import sys
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Callable

import pydantic

from mlflow.utils.annotations import experimental

if TYPE_CHECKING:
    from mlflow.entities.issue import Issue
    from mlflow.entities.trace import Trace
    from mlflow.genai.discovery.entities import DiscoverIssuesResult

_logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pydantic schemas for LLM structured output
# ---------------------------------------------------------------------------


class _AgentDescription(pydantic.BaseModel):
    description: str = pydantic.Field(
        description="What the agent does — a concise summary of its purpose"
    )
    capabilities: list[str] = pydantic.Field(
        description="Tools, skills, or knowledge areas the agent has"
    )
    limitations: list[str] = pydantic.Field(
        description="Known constraints, boundaries, or things the agent cannot do"
    )


class _TestCase(pydantic.BaseModel):
    goal: str = pydantic.Field(description="What the simulated user is trying to accomplish")
    persona: str = pydantic.Field(description="A short role label, e.g. 'MLOps engineer' or 'junior developer'")
    simulation_guidelines: list[str] = pydantic.Field(
        description="Instructions for how the simulated user should behave"
    )


class _TestCaseList(pydantic.BaseModel):
    test_cases: list[_TestCase] = pydantic.Field(description="List of test cases to simulate")


# ---------------------------------------------------------------------------
# Return type
# ---------------------------------------------------------------------------


@experimental(version="3.11.0")
@dataclass
class FindBugsResult:
    """
    Result of :func:`find_bugs`.

    Attributes:
        issues: Issues discovered across all simulated conversations.
        test_cases: Test cases that were generated and simulated.
        agent_description: Natural-language description of the agent
            produced by Step 1.
        simulation_traces: Per-test-case lists of traces produced by
            the conversation simulator.
        discover_issues_result: Full result from the underlying
            :func:`~mlflow.genai.discover_issues` call.
    """

    issues: list[Issue]
    test_cases: list[dict[str, str]]
    agent_description: str
    simulation_traces: list[list[Trace]]
    discover_issues_result: DiscoverIssuesResult | None = None


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

_DESCRIBE_AGENT_SYSTEM_PROMPT = """\
You are an expert at analysing AI agents. Given the agent's own response to \
"describe yourself", extract a structured description."""

_DESCRIBE_AGENT_FROM_TRACES_SYSTEM_PROMPT = """\
You are an expert at analysing AI agents. Given conversation traces from an \
AI agent, extract a structured description of what the agent does, its \
capabilities, and its limitations."""

_DEFAULT_TESTING_GUIDANCE = (
    "Cover a broad mix of the agent's stated capabilities. All test cases should "
    "be realistic. Some should be challenging: ambiguous requests, multi-step "
    "tasks, or requests near the agent's stated limitations."
)

_GENERATE_TEST_CASES_SYSTEM_PROMPT = """\
You are a QA engineer for AI agents. Given a description of an agent, \
generate diverse test cases that exercise different capabilities.

Each test case needs a goal (what the user wants), a persona (a short role \
label like "MLOps engineer" or "junior developer"), and simulation_guidelines \
(a short list of behavioral instructions for the simulated user).

{testing_guidance}

Example output for a weather assistant:

```json
{{
  "test_cases": [
    {{
      "goal": "Get a 7-day weather forecast for Seattle",
      "persona": "Business traveler",
      "simulation_guidelines": ["Ask one follow-up about what to wear"]
    }},
    {{
      "goal": "Compare today's weather in Tokyo and London",
      "persona": "Remote team lead",
      "simulation_guidelines": ["Keep the conversation to 2-3 turns"]
    }}
  ]
}}
```"""


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _get_agent_response_text(predict_fn: Callable[..., Any]) -> str | None:
    """
    Call *predict_fn* with a self-description prompt and return the
    assistant's response as a plain string, or ``None`` on failure.
    """
    from mlflow.genai.utils.trace_utils import (
        extract_outputs_from_trace,
        parse_outputs_to_str,
    )

    prompt = [
        {
            "role": "user",
            "content": (
                "What can you do? Describe your capabilities, tools, and limitations in detail."
            ),
        }
    ]

    sig = inspect.signature(predict_fn)
    params = list(sig.parameters.keys())

    if params and params[0] == "messages":
        result = predict_fn(messages=prompt)
    else:
        result = predict_fn(input=prompt)

    if isinstance(result, str):
        return result

    # Try to extract text the same way the simulator does
    text = parse_outputs_to_str(result)
    if text and text.strip():
        return text

    # Last resort: check the latest trace
    try:
        import mlflow

        if trace := mlflow.get_last_active_trace():
            if outputs := extract_outputs_from_trace(trace):
                text = parse_outputs_to_str(outputs)
                if text and text.strip():
                    return text
    except Exception:
        pass

    # The LLM can analyze any stringified output
    if result is not None:
        return str(result)

    return None


def _describe_agent_from_response(
    response_text: str,
    model: str,
) -> _AgentDescription:
    from mlflow.genai.judges.utils import (
        get_chat_completions_with_structured_output,
    )
    from mlflow.types.llm import ChatMessage

    messages = [
        ChatMessage(role="system", content=_DESCRIBE_AGENT_SYSTEM_PROMPT),
        ChatMessage(
            role="user",
            content=f"Agent's self-description:\n\n{response_text}",
        ),
    ]
    return get_chat_completions_with_structured_output(
        model_uri=model,
        messages=messages,
        output_schema=_AgentDescription,
    )


def _describe_agent_from_traces(
    traces: list[Trace],
    model: str,
) -> _AgentDescription:
    from mlflow.genai.discovery.extraction import (
        extract_execution_paths_for_session,
    )
    from mlflow.genai.discovery.utils import group_traces_by_session
    from mlflow.genai.judges.utils import (
        get_chat_completions_with_structured_output,
    )
    from mlflow.genai.utils.trace_utils import (
        extract_available_tools_from_trace,
        resolve_conversation_from_session,
    )
    from mlflow.types.llm import ChatMessage

    # Build context from traces
    sessions = group_traces_by_session(traces)
    context_parts: list[str] = []

    # Sample up to 5 sessions to keep prompt size manageable
    for session_id, session_traces in list(sessions.items())[:5]:
        if conversation := resolve_conversation_from_session(session_traces):
            formatted = "\n".join(f"  {m['role']}: {m['content']}" for m in conversation)
            context_parts.append(f"Conversation ({session_id}):\n{formatted}")

        paths = extract_execution_paths_for_session(session_traces)
        if paths and paths != "(no routing)":
            context_parts.append(f"Execution paths: {paths}")

    # Extract tools from the first trace that has them
    tools_desc = ""
    for trace in traces[:10]:
        if tools := extract_available_tools_from_trace(trace, model=model):
            tool_names = [t.function.name for t in tools if t.function]
            tools_desc = f"Available tools: {', '.join(tool_names)}"
            break

    if tools_desc:
        context_parts.append(tools_desc)

    messages = [
        ChatMessage(
            role="system",
            content=_DESCRIBE_AGENT_FROM_TRACES_SYSTEM_PROMPT,
        ),
        ChatMessage(
            role="user",
            content="\n\n".join(context_parts) if context_parts else "(no traces)",
        ),
    ]
    return get_chat_completions_with_structured_output(
        model_uri=model,
        messages=messages,
        output_schema=_AgentDescription,
    )


def _generate_test_cases(
    agent_desc: _AgentDescription,
    model: str,
    num_test_cases: int | None = None,
    testing_guidance: str | None = None,
) -> list[dict[str, Any]]:
    from mlflow.genai.judges.utils import (
        get_chat_completions_with_structured_output,
    )
    from mlflow.types.llm import ChatMessage

    guidance = testing_guidance or _DEFAULT_TESTING_GUIDANCE
    count = num_test_cases or 7
    user_content = (
        f"Agent description: {agent_desc.description}\n\n"
        f"Capabilities:\n"
        + "\n".join(f"- {c}" for c in agent_desc.capabilities)
        + "\n\nLimitations:\n"
        + "\n".join(f"- {lim}" for lim in agent_desc.limitations)
        + f"\n\nGenerate {count} diverse test cases."
    )

    system_prompt = _GENERATE_TEST_CASES_SYSTEM_PROMPT.format(
        testing_guidance=guidance,
    )
    messages = [
        ChatMessage(role="system", content=system_prompt),
        ChatMessage(role="user", content=user_content),
    ]
    result = get_chat_completions_with_structured_output(
        model_uri=model,
        messages=messages,
        output_schema=_TestCaseList,
    )

    test_cases = [tc.model_dump() for tc in result.test_cases]
    if num_test_cases is not None:
        test_cases = test_cases[:num_test_cases]
    return test_cases


def _load_traces(
    experiment_id: str | None,
    traces: list[Trace] | None,
) -> list[Trace] | None:
    if traces is not None:
        return traces

    if experiment_id is None:
        return None

    import mlflow

    found = mlflow.search_traces(
        experiment_ids=[experiment_id],
        max_results=50,
        return_type="list",
    )
    return found or None


def _is_jupyter() -> bool:
    try:
        from IPython import get_ipython

        return get_ipython() is not None
    except ImportError:
        return False


def _resolve_scenarios_tab_url(run_id: str, experiment_id: str) -> str | None:
    from mlflow.store.tracking.rest_store import RestStore
    from mlflow.tracking._tracking_service.utils import _get_store, get_tracking_uri
    from mlflow.utils.mlflow_tags import MLFLOW_DATABRICKS_WORKSPACE_URL
    from mlflow.utils.uri import is_databricks_uri

    store = _get_store()
    if not isinstance(store, RestStore):
        return None

    run = store.get_run(run_id)
    if is_databricks_uri(get_tracking_uri()):
        workspace_url = run.data.tags.get(MLFLOW_DATABRICKS_WORKSPACE_URL)
        if not workspace_url:
            workspace_url = store.get_host_creds().host.rstrip("/")
        url_base = f"{workspace_url}/ml"
    else:
        host_url = store.get_host_creds().host.rstrip("/")
        url_base = f"{host_url}/#"
    return f"{url_base}/experiments/{experiment_id}/runs/{run_id}/scenarios"


def _display_test_cases_table(test_cases: list[dict[str, Any]]) -> None:
    import pandas as pd

    rows = []
    for i, tc in enumerate(test_cases, 1):
        guidelines = tc.get("simulation_guidelines", [])
        if isinstance(guidelines, list):
            guidelines = "; ".join(guidelines)
        rows.append(
            {
                "#": i,
                "Goal": tc.get("goal", ""),
                "Persona": tc.get("persona", ""),
                "Guidelines": guidelines,
            }
        )
    df = pd.DataFrame(rows)

    if _is_jupyter():
        from IPython.display import display

        display(df)
    else:
        sys.stdout.write("\nGenerated test cases:\n")
        sys.stdout.write(df.to_string(index=False))
        sys.stdout.write("\n\n")


def _review_test_cases_checkpoint(
    test_cases: list[dict[str, Any]],
    experiment_id: str | None,
    agent_desc: _AgentDescription | None = None,
    model: str | None = None,
) -> tuple[list[dict[str, Any]], str]:
    """
    Create an MLflow run and evaluation dataset for interactive review.

    Returns the (possibly edited) test cases and the run ID.
    """
    import mlflow
    from mlflow.genai.datasets import create_dataset, set_dataset_tags
    from mlflow.utils.mlflow_tags import (
        MLFLOW_FIND_BUGS_AGENT_DESCRIPTION,
        MLFLOW_FIND_BUGS_DATASET_ID,
        MLFLOW_FIND_BUGS_MODEL,
        MLFLOW_RUN_IS_ISSUE_DETECTION,
    )

    # Start a run
    run = mlflow.start_run(
        experiment_id=experiment_id,
        run_name="issue-detection",
        tags={MLFLOW_RUN_IS_ISSUE_DETECTION: "true"},
    )
    run_id = run.info.run_id
    active_experiment_id = run.info.experiment_id

    # Create evaluation dataset
    dataset_name = f"find_bugs_scenarios_{run_id}"
    dataset = create_dataset(
        name=dataset_name,
        experiment_id=active_experiment_id,
    )
    dataset_id = dataset.dataset_id

    # Upsert test cases as records
    records = []
    for tc in test_cases:
        guidelines = tc.get("simulation_guidelines", [])
        if isinstance(guidelines, list):
            guidelines = "; ".join(guidelines)
        records.append(
            {
                "inputs": {
                    "goal": tc.get("goal", ""),
                    "persona": tc.get("persona", ""),
                    "simulation_guidelines": guidelines,
                },
            }
        )
    dataset.merge_records(records)

    # Set dataset tag to pending_review
    set_dataset_tags(dataset_id=dataset_id, tags={"status": "pending_review"})

    # Store dataset ID and agent metadata on the run
    mlflow.set_tag(MLFLOW_FIND_BUGS_DATASET_ID, dataset_id)
    if agent_desc:
        mlflow.set_tag(MLFLOW_FIND_BUGS_AGENT_DESCRIPTION, agent_desc.model_dump_json())
    if model:
        mlflow.set_tag(MLFLOW_FIND_BUGS_MODEL, model)

    # End the run so discover_issues can re-open it
    mlflow.end_run()

    # Display table locally
    _display_test_cases_table(test_cases)

    # Display URL
    url = _resolve_scenarios_tab_url(run_id, active_experiment_id)
    if url:
        if _is_jupyter():
            from IPython.display import HTML, display

            display(
                HTML(
                    f'<p>Review and edit scenarios in the '
                    f'<a href="{url}" target="_blank">Scenarios tab</a>, '
                    f"then click <b>Confirm &amp; Run</b>.</p>"
                )
            )
        else:
            sys.stdout.write(
                f"Review and edit scenarios at \033[93m{url}\033[0m\n"
                "Click 'Confirm & Run' in the UI to continue.\n\n"
            )
    else:
        sys.stdout.write(
            "Review scenarios in the MLflow UI Scenarios tab, "
            "then click 'Confirm & Run' to continue.\n\n"
        )

    # Poll for confirmation
    _logger.info("Waiting for scenario review confirmation...")
    from mlflow.genai.datasets import get_dataset

    while True:
        time.sleep(3)
        ds = get_dataset(dataset_id=dataset_id)
        tags_dict = ds.tags or {}
        if tags_dict.get("status") == "confirmed":
            break

    _logger.info("Scenarios confirmed, proceeding with simulation")

    # Read confirmed records
    confirmed_df = ds.to_df()
    confirmed_test_cases = []
    for _, row in confirmed_df.iterrows():
        inputs = row.get("inputs", {})
        if isinstance(inputs, str):
            import json

            inputs = json.loads(inputs)
        confirmed_test_cases.append(
            {
                "goal": inputs.get("goal", ""),
                "persona": inputs.get("persona", ""),
                "simulation_guidelines": inputs.get("simulation_guidelines", ""),
            }
        )

    return confirmed_test_cases, run_id


def _load_test_cases_from_run(run_id: str) -> tuple[list[dict[str, Any]], str]:
    """Load confirmed test cases from an existing find_bugs run."""
    import json

    import mlflow
    from mlflow.genai.datasets import get_dataset
    from mlflow.utils.mlflow_tags import MLFLOW_FIND_BUGS_DATASET_ID

    run = mlflow.get_run(run_id)
    dataset_id = run.data.tags.get(MLFLOW_FIND_BUGS_DATASET_ID)
    if not dataset_id:
        raise ValueError(
            f"Run {run_id} does not have a dataset ID tag "
            f"({MLFLOW_FIND_BUGS_DATASET_ID}). Cannot resume."
        )

    ds = get_dataset(dataset_id=dataset_id)
    df = ds.to_df()
    test_cases = []
    for _, row in df.iterrows():
        inputs = row.get("inputs", {})
        if isinstance(inputs, str):
            inputs = json.loads(inputs)
        test_cases.append(
            {
                "goal": inputs.get("goal", ""),
                "persona": inputs.get("persona", ""),
                "simulation_guidelines": inputs.get("simulation_guidelines", ""),
            }
        )

    if not test_cases:
        raise ValueError(f"No test cases found in dataset {dataset_id} for run {run_id}.")

    agent_desc_json = run.data.tags.get("mlflow.findBugs.agentDescription", "")
    description_str = ""
    if agent_desc_json:
        try:
            desc = _AgentDescription.model_validate_json(agent_desc_json)
            description_str = (
                f"{desc.description}\n\n"
                f"Capabilities: {', '.join(desc.capabilities)}\n"
                f"Limitations: {', '.join(desc.limitations)}"
            )
        except Exception:
            description_str = agent_desc_json

    return test_cases, description_str


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


@experimental(version="3.11.0")
def find_bugs(
    predict_fn: Callable[..., Any],
    *,
    run_id: str | None = None,
    experiment_id: str | None = None,
    traces: list[Trace] | None = None,
    model: str | None = None,
    max_turns: int = 10,
    max_issues: int = 20,
    num_test_cases: int | None = None,
    testing_guidance: str | None = None,
    review_test_cases: bool = True,
) -> FindBugsResult:
    """
    Automatically stress-test a conversational AI agent and discover bugs.

    Runs a multi-step pipeline:

    1. **Describe** — asks the agent to describe itself (falls back to
       analysing existing traces when available).
    2. **Generate test cases** — uses an LLM to create diverse,
       targeted test scenarios from the agent description.
    3. **Simulate conversations** — runs each test case through the
       :class:`~mlflow.genai.simulators.ConversationSimulator`.
    4. **Discover issues** — analyses simulation traces with
       :func:`~mlflow.genai.discover_issues`.

    Args:
        predict_fn: Agent function compatible with
            :class:`~mlflow.genai.simulators.ConversationSimulator`.
            Must accept either ``input`` or ``messages`` for conversation
            history.
        run_id: Optional run ID from a previous ``find_bugs()`` call.
            When provided, skips steps 1-2 and loads the confirmed
            scenarios from the existing run's dataset, resuming from
            simulation (step 3).
        experiment_id: Optional experiment containing existing traces to
            help describe the agent. Ignored when ``traces`` is provided.
        traces: Optional list of existing traces to help describe the
            agent.
        model: LLM used for analysis, test generation, and simulation.
            Defaults to :func:`~mlflow.genai.simulators.utils.get_default_simulation_model`.
        max_turns: Maximum conversation turns per test case.
        max_issues: Maximum number of issues to report.
        num_test_cases: Number of test cases to generate. When ``None``
            the LLM decides (typically 5-10).
        testing_guidance: Optional natural-language guidance for what
            kinds of queries to test. For example,
            ``"Focus on multi-step financial workflows"``.
            When ``None``, uses a default that covers a broad,
            realistic mix of the agent's capabilities.
        review_test_cases: When ``True``, pauses after generating test
            cases and creates an evaluation dataset so users can review,
            edit, and confirm scenarios in the MLflow UI before the
            expensive simulation step runs.

    Returns:
        A :class:`FindBugsResult` containing discovered issues, generated
        test cases, the agent description, simulation traces, and the
        full :class:`~mlflow.genai.discovery.entities.DiscoverIssuesResult`.
    """
    from mlflow.genai.discovery import discover_issues
    from mlflow.genai.simulators import ConversationSimulator
    from mlflow.genai.simulators.utils import get_default_simulation_model

    model = model or get_default_simulation_model()

    # ------------------------------------------------------------------
    # Resume from existing run
    # ------------------------------------------------------------------
    if run_id is not None:
        _logger.info("Resuming from run %s — loading confirmed scenarios", run_id)
        test_cases, description_str = _load_test_cases_from_run(run_id)
        _logger.info("Loaded %d test cases from run %s", len(test_cases), run_id)
    else:
        # ------------------------------------------------------------------
        # Step 1: Describe the agent
        # ------------------------------------------------------------------
        _logger.info("Step 1/4: Describing the agent")
        agent_desc: _AgentDescription | None = None

        # Primary: ask the agent directly
        response_text = _get_agent_response_text(predict_fn)
        if response_text and len(response_text.strip()) > 20:
            agent_desc = _describe_agent_from_response(response_text, model)

        # Fallback: analyse existing traces
        if agent_desc is None or not agent_desc.capabilities:
            if existing_traces := _load_traces(experiment_id, traces):
                agent_desc = _describe_agent_from_traces(existing_traces, model)

        if agent_desc is None:
            # Last resort: use whatever thin response we got
            if response_text:
                agent_desc = _describe_agent_from_response(response_text, model)
            else:
                agent_desc = _AgentDescription(
                    description="A conversational AI agent",
                    capabilities=["general conversation"],
                    limitations=["unknown"],
                )

        description_str = (
            f"{agent_desc.description}\n\n"
            f"Capabilities: {', '.join(agent_desc.capabilities)}\n"
            f"Limitations: {', '.join(agent_desc.limitations)}"
        )
        _logger.info("Agent description: %s", agent_desc.description)

        # ------------------------------------------------------------------
        # Step 2: Generate test cases
        # ------------------------------------------------------------------
        _logger.info("Step 2/4: Generating test cases")
        test_cases = _generate_test_cases(agent_desc, model, num_test_cases, testing_guidance)
        _logger.info("Generated %d test cases", len(test_cases))

        # ------------------------------------------------------------------
        # Review checkpoint (optional)
        # ------------------------------------------------------------------
        if review_test_cases:
            test_cases, run_id = _review_test_cases_checkpoint(
                test_cases, experiment_id, agent_desc=agent_desc, model=model
            )

    # ------------------------------------------------------------------
    # Step 3: Simulate conversations
    # ------------------------------------------------------------------
    _logger.info("Step 3/4: Simulating conversations")
    simulator = ConversationSimulator(
        test_cases=test_cases,
        max_turns=max_turns,
        user_model=model,
    )
    simulation_traces = simulator.simulate(predict_fn)

    # ------------------------------------------------------------------
    # Step 4: Discover issues
    # ------------------------------------------------------------------
    _logger.info("Step 4/4: Discovering issues")
    flat_traces = [t for session in simulation_traces for t in session]
    discover_result = discover_issues(
        traces=flat_traces,
        model=model,
        max_issues=max_issues,
        run_id=run_id,
    )

    return FindBugsResult(
        issues=discover_result.issues,
        test_cases=test_cases,
        agent_description=description_str,
        simulation_traces=simulation_traces,
        discover_issues_result=discover_result,
    )
