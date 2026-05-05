"""Implementation of ``mlflow agent connect`` (Epic 8 / YUK-48).

Self-registration entry point for an agent: starts the local ``@invoke``
agent on a free port, POSTs ``/agent-connections/register`` to a running
playground, and blocks until SIGTERM/SIGINT, at which point it deregisters
and tears down the agent subprocess.

Used by:

* The worker dispatch flow (YUK-51), which spawns this command in the
  fix-attempt worktree after Claude exits.
* Any user attaching a hand-edited agent to the playground for testing.
"""

from __future__ import annotations

import signal
import socket
import sys
from pathlib import Path
from typing import Any

import click
import httpx

from mlflow.playground.server import (
    _launch_local_agent_process,
    _terminate_process,
    _wait_for_agent_health,
)
from mlflow.utils.git_utils import get_git_branch, get_git_commit

DEFAULT_PLAYGROUND_URL = "http://127.0.0.1:5000"
REGISTER_TIMEOUT_SECONDS = 10.0
DEREGISTER_TIMEOUT_SECONDS = 5.0


def _find_free_port() -> int:
    """Bind to port 0 and let the kernel pick a free one."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _register(
    playground_url: str,
    *,
    name: str,
    agent_url: str,
    repo_dir: Path,
    source_issue: str | None,
    branch: str | None,
    base_commit: str | None,
) -> str:
    """POST /agent-connections/register and return the connection_id."""
    url = f"{playground_url.rstrip('/')}/ajax-api/3.0/mlflow/playground/agent-connections/register"
    body: dict[str, Any] = {
        "name": name,
        "agent_url": agent_url,
        "repo_dir": str(repo_dir),
        "status": "ready",
    }
    if source_issue:
        body["source_issue_id"] = source_issue
    if branch:
        body["branch"] = branch
    if base_commit:
        body["base_commit"] = base_commit

    response = httpx.post(url, json=body, timeout=REGISTER_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()["connection_id"]


def _deregister(playground_url: str, connection_id: str) -> None:
    """Best-effort DELETE /agent-connections/{id}; never raises."""
    url = (
        f"{playground_url.rstrip('/')}"
        f"/ajax-api/3.0/mlflow/playground/agent-connections/{connection_id}"
    )
    try:
        httpx.delete(url, timeout=DEREGISTER_TIMEOUT_SECONDS)
    except Exception:
        # If the playground is gone, the connection is gone too. No reason
        # to surface the error during shutdown.
        pass


def run_connect(
    *,
    playground_url: str,
    name: str,
    source_issue: str | None,
    port: int,
    repo_dir: Path,
) -> None:
    """Start the agent + register; block until interrupted; deregister + tear down.

    Logs progress via click.echo so the operator sees what's happening when
    invoking from a shell.
    """
    repo_dir = repo_dir.resolve()
    if port == 0:
        port = _find_free_port()
    agent_url = f"http://127.0.0.1:{port}"

    click.echo(f"Starting agent at {agent_url} (cwd={repo_dir})…")
    process = _launch_local_agent_process(repo_dir, agent_url)

    if not _wait_for_agent_health(agent_url, timeout_seconds=20.0):
        _terminate_process(process)
        raise click.ClickException(f"Agent at {agent_url} did not become healthy within 20s.")

    branch = get_git_branch(str(repo_dir))
    base_commit = get_git_commit(str(repo_dir))

    click.echo(f"Registering connection {name!r} with playground at {playground_url}…")
    try:
        connection_id = _register(
            playground_url,
            name=name,
            agent_url=agent_url,
            repo_dir=repo_dir,
            source_issue=source_issue,
            branch=branch,
            base_commit=base_commit,
        )
    except httpx.HTTPError as exc:
        _terminate_process(process)
        raise click.ClickException(f"Failed to register with playground: {exc}") from exc

    click.echo(f"Connected: connection_id={connection_id}. Press Ctrl-C to disconnect.")

    cleanup_done = {"flag": False}

    def cleanup() -> None:
        if cleanup_done["flag"]:
            return
        cleanup_done["flag"] = True
        click.echo("Disconnecting…")
        _deregister(playground_url, connection_id)
        _terminate_process(process)

    def _signal_handler(*_: Any) -> None:
        cleanup()
        sys.exit(0)

    signal.signal(signal.SIGTERM, _signal_handler)
    signal.signal(signal.SIGINT, _signal_handler)

    try:
        # Surface unexpected agent exits as a non-zero CLI exit so callers
        # (e.g. the worker dispatcher) can react.
        exit_code = process.wait()
        cleanup()
        if exit_code != 0:
            raise click.ClickException(f"Agent process exited with code {exit_code}.")
    finally:
        cleanup()


__all__ = ["run_connect", "DEFAULT_PLAYGROUND_URL"]
