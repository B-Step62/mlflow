"""Worker dispatch helpers (Epic 8 / YUK-50, YUK-51).

The worker flow turns an Issue into an autonomously-fixed agent version:

1. ``create_worker_worktree`` clones the agent repo into
   ``.mlflow/worktrees/<issue-id>/`` on a fresh ``worker/<issue-id>`` branch.
2. ``dispatch_claude_fix`` runs ``claude -p <prompt>`` in the worktree,
   telling Claude to iterate on ``mlflow agent test run --issue X`` until
   the test is green. After Claude exits we boot the fixed agent on a free
   local port and flip the placeholder connection from `pending` to
   `ready` (or `failed` if Claude couldn't reach green).

`dispatch_claude_fix` runs in a daemon thread; the dispatch endpoint
(YUK-50) returns immediately and the UI polls `/agent-connections` to
notice when the worker becomes ready.
"""

from __future__ import annotations

import logging
import socket
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mlflow.playground.server import PlaygroundRuntime

_logger = logging.getLogger(__name__)

WORKER_BRANCH_PREFIX = "worker/"
CLAUDE_TIMEOUT_SECONDS = 600.0
TEST_TIMEOUT_SECONDS = 180.0
AGENT_HEALTH_TIMEOUT_SECONDS = 30.0
MAX_FIX_ATTEMPTS = 5


@dataclass
class WorkerWorktree:
    worktree_path: Path
    branch: str
    base_commit: str
    base_branch: str


def _git(*args: str, cwd: Path) -> str:
    return subprocess.check_output(["git", *args], cwd=cwd, text=True).strip()


def _git_run(*args: str, cwd: Path) -> None:
    subprocess.check_call(["git", *args], cwd=cwd)


def _worker_branch_for(issue_id: str) -> str:
    return f"{WORKER_BRANCH_PREFIX}{issue_id}"


def _worktree_path_for(repo_dir: Path, issue_id: str) -> Path:
    return repo_dir / ".mlflow" / "worktrees" / issue_id


def create_worker_worktree(repo_dir: Path, issue_id: str) -> WorkerWorktree:
    """Create a `worker/<issue-id>` branch + isolated worktree off the current HEAD.

    Refuses if the worktree directory or branch already exists — the caller
    (dispatch endpoint) should `prune_worker_worktree` first or refuse the
    new dispatch with a clear error.
    """
    repo_dir = repo_dir.resolve()
    branch = _worker_branch_for(issue_id)
    worktree_path = _worktree_path_for(repo_dir, issue_id)

    if worktree_path.exists():
        raise FileExistsError(f"Worktree path already exists: {worktree_path}")

    base_commit = _git("rev-parse", "HEAD", cwd=repo_dir)
    base_branch = _git("rev-parse", "--abbrev-ref", "HEAD", cwd=repo_dir)

    worktree_path.parent.mkdir(parents=True, exist_ok=True)
    _git_run("worktree", "add", "-b", branch, str(worktree_path), base_branch, cwd=repo_dir)

    return WorkerWorktree(
        worktree_path=worktree_path,
        branch=branch,
        base_commit=base_commit,
        base_branch=base_branch,
    )


def prune_worker_worktree(repo_dir: Path, issue_id: str, *, force: bool = False) -> None:
    """Best-effort cleanup of a worker worktree + branch.

    Used by the discard path (YUK-55) and by failed dispatches that need to
    roll back. ``force=True`` removes the worktree even if it has uncommitted
    changes (drop user's WIP — only set this for known-bad states).
    """
    repo_dir = repo_dir.resolve()
    branch = _worker_branch_for(issue_id)
    worktree_path = _worktree_path_for(repo_dir, issue_id)

    if worktree_path.exists():
        cmd = ["git", "worktree", "remove"]
        if force:
            cmd.append("--force")
        cmd.append(str(worktree_path))
        try:
            subprocess.check_call(cmd, cwd=repo_dir)
        except subprocess.CalledProcessError:
            # Stale worktree refs — `git worktree prune` then try again.
            subprocess.run(["git", "worktree", "prune"], cwd=repo_dir, check=False)

    # Delete the branch (best-effort; -D drops unmerged commits).
    subprocess.run(["git", "branch", "-D", branch], cwd=repo_dir, check=False)


# ---------------------------------------------------------------------------
# Claude dispatch (YUK-51)
# ---------------------------------------------------------------------------


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def build_claude_fix_prompt(issue_id: str) -> str:
    """Compose the prompt handed to ``claude -p ...``.

    Looks up the Issue + its regression test row and tells Claude to fix
    the agent code, iterating on ``mlflow agent test run --issue X`` until
    exit code 0 (or attempts exhausted).
    """
    from mlflow.exceptions import MlflowException
    from mlflow.playground.regression_suite import get_or_create_regression_dataset
    from mlflow.tracking._tracking_service.utils import _get_store

    store = _get_store()
    issue = store.get_issue(issue_id)

    test_case = None
    try:
        dataset = get_or_create_regression_dataset(str(issue.experiment_id))
        df = dataset.to_df()
        if not df.empty:
            for _, row in df.iterrows():
                tags = row.get("tags") or {}
                if tags.get("issue_id") == issue_id:
                    test_case = row
                    break
    except MlflowException:
        # No regression dataset yet — Claude will work from issue text alone.
        pass

    lines: list[str] = [
        f"# Fix MLflow Agent Playground Issue {issue_id}",
        "",
        f"**Title:** {issue.name}",
    ]
    if issue.source_trace_id:
        lines.append(f"**Source trace:** `{issue.source_trace_id}`")
    if issue.test_case_id:
        lines.append(f"**Test case:** `{issue.test_case_id}`")
    lines.extend([
        "",
        "## What went wrong",
        (issue.description or "(no rationale recorded)").strip(),
        "",
    ])

    if test_case is not None:
        import json

        test_spec = (test_case.get("expectations") or {}).get("test_spec") or {}
        messages = (test_case.get("inputs") or {}).get("messages") or []
        expected = (test_case.get("expectations") or {}).get("expected_response")
        lines.extend([
            "## Test the agent must satisfy",
            "```json",
            json.dumps(test_spec, indent=2),
            "```",
            "",
            "## Conversation prefix the test replays",
            "```json",
            json.dumps(messages, indent=2),
            "```",
            "",
        ])
        if expected:
            lines.extend(["**Reference response:**", str(expected), ""])

    lines.extend([
        "## Your job",
        (
            "Edit the @invoke-decorated agent in this repo so the regression "
            "test below exits 0. Touch only the agent code; do NOT modify "
            "the test row itself (MLflow regenerates it from the original "
            "feedback if you delete it)."
        ),
        "",
        "## Iterate",
        (
            f"After every change, run the verify command. Iterate up to "
            f"{MAX_FIX_ATTEMPTS} times. Commit each successful change with a "
            "descriptive message before moving on."
        ),
        "",
        "## Verify",
        "```bash",
        f"mlflow agent test run --issue {issue_id}",
        "```",
        (
            "Exit code 0 = pass. Stop iterating once green and commit. If "
            "you cannot reach green within the iteration cap, leave the "
            "best partial fix committed and exit — the user will review."
        ),
    ])
    return "\n".join(lines)


def _mark_connection(
    runtime: PlaygroundRuntime,
    connection_id: str,
    *,
    status: str,
    status_message: str | None = None,
    agent_url: str | None = None,
    process: subprocess.Popen | None = None,
    log_path: Path | None = None,
) -> None:
    with runtime.connections_lock:
        connection = runtime.connections.get(connection_id)
        if connection is None:
            return
        connection.status = status  # type: ignore[assignment]
        connection.status_message = status_message
        if agent_url is not None:
            connection.agent_url = agent_url
        if process is not None:
            connection.process = process
        if log_path is not None:
            connection.log_path = log_path


def _run_claude(worktree_path: Path, prompt: str, log_path: Path) -> tuple[int | None, str]:
    """Run ``claude -p PROMPT`` in the worktree, log to ``log_path``.

    Returns (exit_code, error_message). exit_code is None when Claude could
    not be invoked at all (timeout, missing CLI).
    """
    log_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with log_path.open("w") as log:
            proc = subprocess.run(
                ["claude", "-p", prompt],
                cwd=worktree_path,
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=CLAUDE_TIMEOUT_SECONDS,
                check=False,
            )
    except subprocess.TimeoutExpired:
        return None, f"Claude timed out after {CLAUDE_TIMEOUT_SECONDS}s"
    except FileNotFoundError:
        return None, "claude CLI not found in PATH"
    return proc.returncode, ""


def _run_final_test(worktree_path: Path, issue_id: str) -> tuple[bool, str]:
    """Final sanity test after Claude exits. Returns (passed, output_excerpt)."""
    try:
        proc = subprocess.run(
            ["mlflow", "agent", "test", "run", "--issue", issue_id],
            cwd=worktree_path,
            capture_output=True,
            text=True,
            timeout=TEST_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False, f"Test timed out after {TEST_TIMEOUT_SECONDS}s"
    output = (proc.stdout + proc.stderr).strip()
    return proc.returncode == 0, output[-1000:]  # last 1KB


def dispatch_claude_fix(
    runtime: PlaygroundRuntime,
    *,
    issue_id: str,
    connection_id: str,
    worktree_path: Path,
) -> threading.Thread:
    """Spawn the Claude dispatch in a background daemon thread.

    Returns the started thread (mostly for tests; the caller doesn't usually
    care since the connection state machine is the source of truth).
    """
    from mlflow.playground.server import (
        _launch_local_agent_process,
        _terminate_process,
        _wait_for_agent_health,
    )

    log_path = worktree_path / ".mlflow" / "claude.log"

    def run() -> None:
        try:
            prompt = build_claude_fix_prompt(issue_id)
        except Exception as exc:
            _logger.exception("Failed to build prompt for %s", issue_id)
            _mark_connection(
                runtime,
                connection_id,
                status="failed",
                status_message=f"Could not build fix prompt: {exc}",
            )
            return

        exit_code, claude_error = _run_claude(worktree_path, prompt, log_path)
        if exit_code is None:
            _mark_connection(
                runtime,
                connection_id,
                status="failed",
                status_message=claude_error,
                log_path=log_path,
            )
            return

        passed, test_output = _run_final_test(worktree_path, issue_id)
        if not passed:
            _mark_connection(
                runtime,
                connection_id,
                status="failed",
                status_message=(
                    f"Claude exited (code={exit_code}) but the regression test "
                    f"is still red.\n{test_output}"
                ),
                log_path=log_path,
            )
            return

        port = _find_free_port()
        agent_url = f"http://127.0.0.1:{port}"
        try:
            agent_proc = _launch_local_agent_process(worktree_path, agent_url)
        except Exception as exc:
            _logger.exception("Failed to launch worker agent for %s", issue_id)
            _mark_connection(
                runtime,
                connection_id,
                status="failed",
                status_message=f"Failed to launch worker agent: {exc}",
                log_path=log_path,
            )
            return

        if not _wait_for_agent_health(agent_url, timeout_seconds=AGENT_HEALTH_TIMEOUT_SECONDS):
            _terminate_process(agent_proc)
            _mark_connection(
                runtime,
                connection_id,
                status="failed",
                status_message=(
                    f"Worker agent at {agent_url} did not become healthy within "
                    f"{AGENT_HEALTH_TIMEOUT_SECONDS}s."
                ),
                log_path=log_path,
            )
            return

        _mark_connection(
            runtime,
            connection_id,
            status="ready",
            status_message=None,
            agent_url=agent_url,
            process=agent_proc,
            log_path=log_path,
        )

        # Transition the issue: in_progress → review.
        try:
            from mlflow.entities.issue import IssueStatus
            from mlflow.tracking._tracking_service.utils import _get_store

            _get_store().transition_issue(issue_id, IssueStatus.REVIEW, connection_id)
        except Exception:
            _logger.exception("Failed to transition issue %s to review", issue_id)
            # Don't fail the connection — the user can review the worker
            # output even if the state-machine update lagged.

    thread = threading.Thread(target=run, daemon=True, name=f"worker-{issue_id}")
    thread.start()
    return thread


__all__ = [
    "MAX_FIX_ATTEMPTS",
    "WORKER_BRANCH_PREFIX",
    "WorkerWorktree",
    "build_claude_fix_prompt",
    "create_worker_worktree",
    "dispatch_claude_fix",
    "prune_worker_worktree",
]
