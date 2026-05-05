"""Local bootstrap for auto-starting an MLflow agent server from a repo."""

from __future__ import annotations

import argparse
import importlib
import importlib.util
import inspect
import sys
from pathlib import Path
from types import ModuleType

import uvicorn

from mlflow.genai.agent_server import AgentServer, get_invoke_function
import mlflow.genai.agent_server.server as agent_server_module

EXCLUDED_DIR_NAMES = {
    ".git",
    ".hg",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    ".venv",
    "__pycache__",
    "build",
    "dist",
    "env",
    "node_modules",
    "site-packages",
    "tests",
    "venv",
}
PREFERRED_FILENAMES = ("agent.py", "app.py", "main.py", "server.py")


def _iter_candidate_files(repo_dir: Path) -> list[Path]:
    candidates: list[Path] = []
    for path in repo_dir.rglob("*.py"):
        if any(part in EXCLUDED_DIR_NAMES for part in path.parts):
            continue
        try:
            source = path.read_text(encoding="utf-8")
        except Exception:
            continue
        if "@invoke(" not in source:
            continue
        candidates.append(path)

    return sorted(
        candidates,
        key=lambda path: (
            path.name not in PREFERRED_FILENAMES,
            len(path.relative_to(repo_dir).parts),
            str(path.relative_to(repo_dir)),
        ),
    )


def _module_name_from_path(path: Path, repo_dir: Path) -> str:
    relative = path.relative_to(repo_dir).with_suffix("")
    return ".".join(relative.parts)


def _import_module_from_path(path: Path, repo_dir: Path) -> ModuleType:
    sys.path.insert(0, str(repo_dir))
    module_name = _module_name_from_path(path, repo_dir)

    try:
        return importlib.import_module(module_name)
    except Exception:
        pass

    fallback_name = f"_mlflow_playground_bootstrap_{path.stem}"
    spec = importlib.util.spec_from_file_location(fallback_name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load module from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _detect_agent_type(path: Path) -> str | None:
    try:
        source = path.read_text(encoding="utf-8")
    except Exception:
        return None
    if "ResponsesAgentRequest" in source or "ResponsesAgentResponse" in source:
        return "ResponsesAgent"
    return None


def _adapt_invoke_signature() -> None:
    invoke_fn = get_invoke_function()
    if invoke_fn is None:
        return

    signature = inspect.signature(invoke_fn)
    params = list(signature.parameters.values())
    if len(params) != 1:
        return

    param = params[0]
    annotation = param.annotation
    param_name = param.name

    accepts_request_object = param_name == "request" or "Request" in str(annotation)
    if accepts_request_object:
        return

    def wrapped(request):
        if isinstance(request, dict):
            if param_name == "messages" and "messages" in request:
                return invoke_fn(request["messages"])
            if param_name == "input" and "input" in request:
                return invoke_fn(request["input"])
        return invoke_fn(request)

    agent_server_module._invoke_function = wrapped


def discover_agent(repo_dir: Path) -> tuple[Path, str | None]:
    for candidate in _iter_candidate_files(repo_dir):
        agent_server_module._invoke_function = None
        agent_server_module._stream_function = None
        try:
            _import_module_from_path(candidate, repo_dir)
        except Exception:
            continue
        if get_invoke_function() is not None:
            _adapt_invoke_signature()
            return candidate, _detect_agent_type(candidate)
    raise SystemExit(
        "Could not find a usable @invoke() entrypoint under "
        f"{repo_dir}. Run `mlflow agent setup` in the agent repo first."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Auto-start a local MLflow agent server.")
    parser.add_argument("--repo-dir", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    repo_dir = Path(args.repo_dir).resolve()
    if not repo_dir.exists():
        raise SystemExit(f"Repo directory does not exist: {repo_dir}")

    candidate, agent_type = discover_agent(repo_dir)
    print(f"MLflow Agent Playground loaded entrypoint from {candidate}", flush=True)

    server = AgentServer(agent_type)
    uvicorn.run(server.app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
