"""Local bootstrap for auto-starting an MLflow agent server from a repo.

Hot-reload contract
-------------------
``main()`` (the parent process) parses CLI args, stashes the repo dir into
``MLFLOW_PLAYGROUND_AGENT_REPO_DIR``, and execs uvicorn with the import string
``mlflow.playground.agent_bootstrap:app`` plus ``--reload``. uvicorn forks a
worker per code change; each worker re-imports this module, which re-runs
``discover_agent`` against the (possibly edited) repo and rebuilds the
``AgentServer`` app from scratch. So the user can edit their agent file and
the next request picks up the new code without restarting the playground.

The ``app`` attribute is only built when the env var is set, so importing
this module from tests / tooling stays cheap and side-effect-free.
"""

from __future__ import annotations

import argparse
import importlib
import importlib.util
import inspect
import os
import sys
from pathlib import Path
from types import ModuleType

import uvicorn

from mlflow.genai.agent_server import AgentServer, get_invoke_function
import mlflow.genai.agent_server.server as agent_server_module

# Parent sets this for the uvicorn worker. We don't pass repo_dir on the
# command line because uvicorn's reload subprocess gets a different argv.
_REPO_DIR_ENV = "MLFLOW_PLAYGROUND_AGENT_REPO_DIR"

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


def _build_app():
    """Build the AgentServer FastAPI app from the repo dir env var.

    Called at module import time when ``MLFLOW_PLAYGROUND_AGENT_REPO_DIR`` is
    set — i.e. inside the uvicorn worker. Each reload re-imports this module
    and re-runs discovery, so edits to the agent file land in the next worker.
    """
    repo_dir_str = os.environ.get(_REPO_DIR_ENV)
    if not repo_dir_str:
        raise RuntimeError(
            f"{_REPO_DIR_ENV} is not set; agent_bootstrap.app cannot be built. "
            "This module should be loaded via uvicorn started by `main()`."
        )
    repo_dir = Path(repo_dir_str).resolve()
    candidate, agent_type = discover_agent(repo_dir)
    print(f"MLflow Agent Playground loaded entrypoint from {candidate}", flush=True)
    return AgentServer(agent_type).app


# Module-level handle uvicorn imports. Only built inside the worker — bare
# imports (tests, IDE tooling) stay side-effect-free because the env var is
# only set by `main()` before exec'ing uvicorn.
app = _build_app() if os.environ.get(_REPO_DIR_ENV) else None


def main() -> None:
    parser = argparse.ArgumentParser(description="Auto-start a local MLflow agent server.")
    parser.add_argument("--repo-dir", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--no-reload",
        action="store_true",
        help="Disable uvicorn auto-reload on agent file changes (default: reload on).",
    )
    args = parser.parse_args()

    repo_dir = Path(args.repo_dir).resolve()
    if not repo_dir.exists():
        raise SystemExit(f"Repo directory does not exist: {repo_dir}")

    # Stash the repo dir in env so the uvicorn worker can re-run discovery on
    # every reload. Argparse-style flags don't survive the reload spawn.
    os.environ[_REPO_DIR_ENV] = str(repo_dir)

    reload_enabled = not args.no_reload
    # Skip large noisy subtrees so the watcher doesn't spam syscalls when the
    # repo includes a virtualenv or installed test caches. Patterns mirror
    # `EXCLUDED_DIR_NAMES` since the same dirs are unlikely to contain agent
    # source.
    reload_excludes = [f"**/{name}/**" for name in EXCLUDED_DIR_NAMES]
    uvicorn.run(
        "mlflow.playground.agent_bootstrap:app",
        host=args.host,
        port=args.port,
        reload=reload_enabled,
        reload_dirs=[str(repo_dir)] if reload_enabled else None,
        reload_excludes=reload_excludes if reload_enabled else None,
    )


if __name__ == "__main__":
    main()
