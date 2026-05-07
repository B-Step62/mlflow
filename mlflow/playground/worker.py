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

import json
import logging
import socket
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from mlflow.playground.server import PlaygroundRuntime

_logger = logging.getLogger(__name__)

WORKER_BRANCH_PREFIX = "worker/"
CLAUDE_TIMEOUT_SECONDS = 600.0
TEST_TIMEOUT_SECONDS = 180.0
AGENT_HEALTH_TIMEOUT_SECONDS = 30.0
MAX_FIX_ATTEMPTS = 5
DIFF_BYTE_LIMIT = 200_000


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


def _post_comment(
    issue_id: str, body: str, *, author: str = "claude", kind: str = "claude"
) -> None:
    """Append a Linear-style comment to the issue's activity thread.

    Best-effort: failures are logged but never propagated, so a transient
    DB hiccup can't tank a worker dispatch.
    """
    try:
        from mlflow.tracking._tracking_service.utils import _get_store

        _get_store().add_issue_comment(issue_id, body=body, author=author, kind=kind)
    except Exception:
        _logger.exception("Failed to post comment to issue %s", issue_id)


def _summarize_worker_diff(worktree_path: Path, base_commit: str | None) -> str | None:
    """Build a markdown summary of the worker branch (commits + diff stat + diff)."""
    if not base_commit:
        return None
    try:
        log_output = subprocess.check_output(
            ["git", "log", f"{base_commit}..HEAD", "--format=%h %s"],
            cwd=worktree_path,
            text=True,
        )
        diff_stat = subprocess.check_output(
            ["git", "diff", "--stat", f"{base_commit}..HEAD"],
            cwd=worktree_path,
            text=True,
        )
        diff_full = subprocess.check_output(
            ["git", "diff", f"{base_commit}..HEAD"],
            cwd=worktree_path,
            text=True,
        )
    except subprocess.CalledProcessError:
        return None

    if not log_output.strip() and not diff_stat.strip():
        return None

    truncated = ""
    if len(diff_full.encode("utf-8")) > DIFF_BYTE_LIMIT:
        diff_full = diff_full[:DIFF_BYTE_LIMIT]
        truncated = "\n... (diff truncated)\n"

    parts = ["**Commits**", "```", log_output.strip() or "(none)", "```"]
    if diff_stat.strip():
        parts += ["**Stat**", "```", diff_stat.strip(), "```"]
    if diff_full.strip():
        parts += ["**Diff**", "```diff", diff_full + truncated, "```"]
    return "\n".join(parts)


def _summarize_stream_event(event: dict[str, Any]) -> str | None:
    """Render one stream-json event from `claude -p` into a one-line activity entry.

    Returns None for events the activity feed should ignore (init/system messages,
    tool results — the assistant's tool_use already records the call).
    """
    event_type = event.get("type")
    if event_type == "assistant":
        message = event.get("message") or {}
        blocks = message.get("content") or []
        for block in blocks:
            block_type = block.get("type")
            if block_type == "text":
                text = (block.get("text") or "").strip().replace("\n", " ")
                if text:
                    return f"claude: {text[:200]}{'…' if len(text) > 200 else ''}"
            elif block_type == "tool_use":
                name = block.get("name") or "tool"
                tool_input = block.get("input") or {}
                # Render the most identifying scalar field for common tools.
                hint = ""
                for key in ("command", "file_path", "path", "query", "url", "pattern"):
                    value = tool_input.get(key)
                    if isinstance(value, str) and value:
                        hint = value.strip().splitlines()[0][:120]
                        break
                return f"→ {name}({hint})" if hint else f"→ {name}"
        return None
    if event_type == "result":
        subtype = event.get("subtype") or "result"
        cost = event.get("total_cost_usd")
        turns = event.get("num_turns")
        duration_ms = event.get("duration_ms")
        bits: list[str] = [subtype]
        if turns is not None:
            bits.append(f"{turns} turns")
        if duration_ms is not None:
            bits.append(f"{duration_ms / 1000:.0f}s")
        if cost is not None:
            bits.append(f"${cost:.4f}")
        return f"claude finished: {', '.join(bits)}"
    return None


def _run_claude(
    worktree_path: Path,
    prompt: str,
    log_path: Path,
    issue_id: str | None = None,
) -> tuple[int | None, str]:
    """Run ``claude -p PROMPT`` in the worktree, streaming progress.

    Uses ``--output-format stream-json --verbose`` so we get one JSON event
    per model turn / tool call. Each event is written to ``log_path`` as it
    arrives, and (when ``issue_id`` is provided) summarized into a Linear-style
    comment on the issue so reviewers can watch progress live.

    Returns (exit_code, error_message). exit_code is None when Claude could
    not be invoked at all (timeout, missing CLI).
    """
    log_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "claude",
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        prompt,
    ]
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=worktree_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError:
        return None, "claude CLI not found in PATH"

    deadline = time.time() + CLAUDE_TIMEOUT_SECONDS
    try:
        with log_path.open("w") as log:
            assert proc.stdout is not None
            for raw_line in proc.stdout:
                log.write(raw_line)
                log.flush()
                if time.time() > deadline:
                    proc.kill()
                    proc.wait(timeout=5)
                    return None, f"Claude timed out after {CLAUDE_TIMEOUT_SECONDS}s"
                if issue_id is None:
                    continue
                line = raw_line.strip()
                if not line.startswith("{"):
                    # Non-JSON line (e.g. a stderr trace) — skip activity but keep in log.
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                summary = _summarize_stream_event(event)
                if summary:
                    _post_comment(issue_id, summary, author="claude", kind="claude")
        # Streaming loop exited because stdout closed; reap the child.
        try:
            proc.wait(timeout=max(deadline - time.time(), 1.0))
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
            return None, f"Claude timed out after {CLAUDE_TIMEOUT_SECONDS}s"
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)
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
    base_commit: str | None = None
    with runtime.connections_lock:
        connection = runtime.connections.get(connection_id)
        if connection is not None:
            base_commit = connection.base_commit

    def run() -> None:
        _post_comment(issue_id, "Building fix prompt", author="system", kind="system")
        try:
            prompt = build_claude_fix_prompt(issue_id)
        except Exception as exc:
            _logger.exception("Failed to build prompt for %s", issue_id)
            _post_comment(
                issue_id, f"Could not build fix prompt: {exc}", author="system", kind="system"
            )
            _mark_connection(
                runtime,
                connection_id,
                status="failed",
                status_message=f"Could not build fix prompt: {exc}",
            )
            return

        _post_comment(
            issue_id,
            f"Running claude (timeout {CLAUDE_TIMEOUT_SECONDS:.0f}s)",
            author="system",
            kind="system",
        )
        started = time.time()
        exit_code, claude_error = _run_claude(
            worktree_path, prompt, log_path, issue_id=issue_id
        )
        elapsed = time.time() - started
        if exit_code is None:
            _post_comment(
                issue_id, f"Claude failed: {claude_error}", author="system", kind="system"
            )
            _mark_connection(
                runtime,
                connection_id,
                status="failed",
                status_message=claude_error,
                log_path=log_path,
            )
            return
        _post_comment(
            issue_id,
            f"Claude exited (code={exit_code}) after {elapsed:.0f}s",
            author="system",
            kind="system",
        )

        _post_comment(issue_id, "Running regression test", author="system", kind="system")
        passed, test_output = _run_final_test(worktree_path, issue_id)
        diff_summary = _summarize_worker_diff(worktree_path, base_commit)
        if diff_summary:
            _post_comment(issue_id, diff_summary, author="claude", kind="claude")
        if not passed:
            _post_comment(
                issue_id,
                f"Regression test still red:\n```\n{test_output[-1000:]}\n```",
                author="system",
                kind="system",
            )
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
        _post_comment(issue_id, "Regression test passed", author="system", kind="system")

        port = _find_free_port()
        agent_url = f"http://127.0.0.1:{port}"
        _post_comment(
            issue_id,
            f"Launching worker agent on {agent_url}",
            author="system",
            kind="system",
        )
        try:
            agent_proc = _launch_local_agent_process(worktree_path, agent_url)
        except Exception as exc:
            _logger.exception("Failed to launch worker agent for %s", issue_id)
            _post_comment(
                issue_id, f"Failed to launch worker agent: {exc}", author="system", kind="system"
            )
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
            _post_comment(
                issue_id,
                f"Worker agent at {agent_url} never became healthy",
                author="system",
                kind="system",
            )
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

        _post_comment(issue_id, "Worker ready for review", author="system", kind="system")
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


# ---------------------------------------------------------------------------
# Accept / rework / discard (YUK-55)
# ---------------------------------------------------------------------------


class WorkerActionError(Exception):
    """Raised by accept/rework/discard helpers with a user-facing message."""

    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _terminate_connection_process(runtime: PlaygroundRuntime, connection_id: str) -> None:
    """Kill the worker's agent subprocess (if we own one)."""
    from mlflow.playground.server import _terminate_process

    with runtime.connections_lock:
        connection = runtime.connections.get(connection_id)
        if connection is None:
            return
        process = connection.process
        connection.process = None
    if process is not None:
        _terminate_process(process)


def _bounce_main_connection(runtime: PlaygroundRuntime) -> None:
    """Restart the main agent so it picks up freshly-merged code.

    Called by accept after the worker branch is merged into base. We
    terminate the existing agent_process and let `_ensure_agent_running`
    spin up a fresh one on the same agent_url.
    """
    from mlflow.playground.server import _ensure_agent_running, _terminate_process

    with runtime.process_lock:
        if runtime.agent_process is not None:
            _terminate_process(runtime.agent_process)
            runtime.agent_process = None
            runtime.managed_agent_url = None

    main_url: str | None = None
    with runtime.connections_lock:
        for connection in runtime.connections.values():
            if connection.name == "main":
                main_url = connection.agent_url
                break
    if main_url:
        _ensure_agent_running(runtime, main_url)


def accept_worker_connection(runtime: PlaygroundRuntime, connection_id: str) -> dict:
    """Merge worker branch into base, transition issue → done, prune worktree.

    Returns the merge commit + new issue status. Raises WorkerActionError
    on conflict / unexpected git state.
    """
    from mlflow.entities.issue import IssueStatus
    from mlflow.exceptions import MlflowException
    from mlflow.tracking._tracking_service.utils import _get_store

    with runtime.connections_lock:
        connection = runtime.connections.get(connection_id)
        if connection is None:
            raise WorkerActionError(f"Connection {connection_id} not found.", status_code=404)
        if connection.status != "ready":
            raise WorkerActionError(
                f"Cannot accept: connection is in status {connection.status!r}, expected `ready`.",
                status_code=409,
            )
        if not connection.source_issue_id or not connection.branch:
            raise WorkerActionError(
                "Connection is not a worker (missing source_issue_id or branch).",
                status_code=400,
            )

    if runtime.repo_dir is None:
        raise WorkerActionError("Playground has no repo_dir to merge into.", status_code=400)

    # Attempt the merge into the currently checked-out base branch.
    merge_proc = subprocess.run(
        [
            "git",
            "merge",
            "--no-ff",
            "-m",
            f"Accept worker fix for {connection.source_issue_id}",
            connection.branch,
        ],
        cwd=runtime.repo_dir,
        capture_output=True,
        text=True,
        check=False,
    )
    if merge_proc.returncode != 0:
        # Roll back the partial merge so the user's tree is clean.
        subprocess.run(["git", "merge", "--abort"], cwd=runtime.repo_dir, check=False)
        raise WorkerActionError(
            f"Merge failed; resolve conflicts manually with git, then retry.\n"
            f"{merge_proc.stdout}{merge_proc.stderr}",
            status_code=409,
        )

    merge_commit = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=runtime.repo_dir, text=True
    ).strip()

    # Transition issue → done.
    try:
        _get_store().transition_issue(connection.source_issue_id, IssueStatus.DONE, connection_id)
    except MlflowException as exc:
        _logger.exception("Issue transition to done failed for %s", connection.source_issue_id)
        raise WorkerActionError(f"Issue transition failed: {exc}", status_code=500) from exc

    # Append to regression suite (best-effort — same hook as the manual flow).
    # `append_for_issue` is a YUK-15 placeholder that may not yet exist; the
    # manual-accept CLI gracefully ignores ImportError, so do the same here.
    try:
        from mlflow.playground.regression_suite import (
            append_for_issue,  # type: ignore[attr-defined]
        )

        append_for_issue(_get_store().get_issue(connection.source_issue_id))
    except ImportError:
        pass
    except Exception:
        _logger.exception(
            "Regression-suite append failed for %s (continuing)",
            connection.source_issue_id,
        )

    # Tear down the worker's agent + drop connection + prune worktree.
    _terminate_connection_process(runtime, connection_id)
    with runtime.connections_lock:
        runtime.connections.pop(connection_id, None)
        if runtime.active_connection_id == connection_id:
            runtime.active_connection_id = next(
                (c.connection_id for c in runtime.connections.values() if c.name == "main"),
                None,
            )
    prune_worker_worktree(runtime.repo_dir, connection.source_issue_id, force=True)

    # Bounce main so it picks up the merged code.
    _bounce_main_connection(runtime)

    return {
        "merge_commit": merge_commit,
        "issue_id": connection.source_issue_id,
        "issue_status": "done",
    }


def rework_worker_connection(
    runtime: PlaygroundRuntime, connection_id: str, *, feedback: str
) -> dict:
    """Re-spawn Claude with feedback appended; reuse the same worktree."""
    from mlflow.entities.issue import IssueStatus
    from mlflow.exceptions import MlflowException
    from mlflow.tracking._tracking_service.utils import _get_store

    with runtime.connections_lock:
        connection = runtime.connections.get(connection_id)
        if connection is None:
            raise WorkerActionError(f"Connection {connection_id} not found.", status_code=404)
        if connection.status != "ready":
            raise WorkerActionError(
                f"Cannot rework: connection is in status {connection.status!r}, expected `ready`.",
                status_code=409,
            )
        worktree_path = connection.repo_dir
        issue_id = connection.source_issue_id

    if not worktree_path or not issue_id:
        raise WorkerActionError(
            "Connection is missing worktree_path or source_issue_id.", status_code=400
        )

    _terminate_connection_process(runtime, connection_id)

    with runtime.connections_lock:
        connection = runtime.connections.get(connection_id)
        if connection is None:
            raise WorkerActionError(
                f"Connection {connection_id} disappeared during rework.", status_code=404
            )
        connection.status = "pending"  # type: ignore[assignment]
        connection.status_message = f"Re-running with feedback: {feedback[:120]}"
        connection.agent_url = ""
        base_commit = connection.base_commit

    _post_comment(
        issue_id,
        f"Reworking with feedback: {feedback[:120]}",
        author="system",
        kind="system",
    )

    try:
        _get_store().transition_issue(issue_id, IssueStatus.IN_PROGRESS, connection_id)
    except MlflowException:
        _logger.exception("Failed to transition issue %s back to in_progress", issue_id)

    # Wrap the feedback in a follow-up note that build_claude_fix_prompt
    # itself doesn't see — we patch the prompt at dispatch time instead.
    def _build_with_feedback(_issue_id: str = issue_id) -> str:
        base_prompt = build_claude_fix_prompt(_issue_id)
        return (
            base_prompt
            + "\n\n## Reviewer feedback on the previous attempt\n\n"
            + feedback.strip()
            + "\n\nAddress this feedback specifically in the next iteration."
        )

    # Dispatch from inside the worktree the previous attempt used. The
    # commits Claude already made are still there.
    import threading

    def run() -> None:
        prompt = _build_with_feedback()
        from mlflow.playground import worker as _worker_mod

        _post_comment(
            issue_id,
            f"Running claude (timeout {CLAUDE_TIMEOUT_SECONDS:.0f}s)",
            author="system",
            kind="system",
        )
        started = time.time()
        exit_code, claude_error = _worker_mod._run_claude(
            worktree_path,
            prompt,
            worktree_path / ".mlflow" / "claude.log",
            issue_id=issue_id,
        )
        elapsed = time.time() - started
        if exit_code is None:
            _post_comment(
                issue_id, f"Claude failed: {claude_error}", author="system", kind="system"
            )
            _mark_connection(runtime, connection_id, status="failed", status_message=claude_error)
            return
        _post_comment(
            issue_id,
            f"Claude exited (code={exit_code}) after {elapsed:.0f}s",
            author="system",
            kind="system",
        )

        _post_comment(issue_id, "Running regression test", author="system", kind="system")
        passed, output = _worker_mod._run_final_test(worktree_path, issue_id)
        diff_summary = _summarize_worker_diff(worktree_path, base_commit)
        if diff_summary:
            _post_comment(issue_id, diff_summary, author="claude", kind="claude")
        if not passed:
            _post_comment(
                issue_id,
                f"Regression test still red:\n```\n{output[-1000:]}\n```",
                author="system",
                kind="system",
            )
            _mark_connection(
                runtime,
                connection_id,
                status="failed",
                status_message=f"Rework still failed:\n{output}",
            )
            return

        _post_comment(issue_id, "Regression test passed", author="system", kind="system")

        port = _find_free_port()
        agent_url = f"http://127.0.0.1:{port}"
        from mlflow.playground.server import (
            _launch_local_agent_process,
            _wait_for_agent_health,
        )

        _post_comment(
            issue_id,
            f"Launching worker agent on {agent_url}",
            author="system",
            kind="system",
        )
        agent_proc = _launch_local_agent_process(worktree_path, agent_url)
        if not _wait_for_agent_health(agent_url, timeout_seconds=AGENT_HEALTH_TIMEOUT_SECONDS):
            _post_comment(
                issue_id, "Worker agent unhealthy after rework", author="system", kind="system"
            )
            _mark_connection(
                runtime,
                connection_id,
                status="failed",
                status_message="Worker agent unhealthy after rework",
            )
            return
        _post_comment(issue_id, "Worker ready for review", author="system", kind="system")
        _mark_connection(
            runtime,
            connection_id,
            status="ready",
            status_message=None,
            agent_url=agent_url,
            process=agent_proc,
        )
        try:
            _get_store().transition_issue(issue_id, IssueStatus.REVIEW, connection_id)
        except Exception:
            _logger.exception("Issue transition to review failed for %s", issue_id)

    thread = threading.Thread(target=run, daemon=True, name=f"worker-rework-{issue_id}")
    thread.start()
    return {"connection_id": connection_id, "status": "pending"}


def discard_worker_connection(runtime: PlaygroundRuntime, connection_id: str) -> dict:
    """Kill the worker, prune the worktree, drop the connection."""
    with runtime.connections_lock:
        connection = runtime.connections.get(connection_id)
        if connection is None:
            raise WorkerActionError(f"Connection {connection_id} not found.", status_code=404)
        issue_id = connection.source_issue_id

    _terminate_connection_process(runtime, connection_id)
    with runtime.connections_lock:
        runtime.connections.pop(connection_id, None)
        if runtime.active_connection_id == connection_id:
            runtime.active_connection_id = next(
                (c.connection_id for c in runtime.connections.values() if c.name == "main"),
                None,
            )

    if runtime.repo_dir is not None and issue_id:
        prune_worker_worktree(runtime.repo_dir, issue_id, force=True)

    return {"connection_id": connection_id, "discarded": True}


__all__ = [
    "MAX_FIX_ATTEMPTS",
    "WORKER_BRANCH_PREFIX",
    "WorkerActionError",
    "WorkerWorktree",
    "accept_worker_connection",
    "build_claude_fix_prompt",
    "create_worker_worktree",
    "discard_worker_connection",
    "dispatch_claude_fix",
    "prune_worker_worktree",
    "rework_worker_connection",
]
