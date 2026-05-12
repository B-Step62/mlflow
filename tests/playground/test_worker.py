"""Unit tests for worker.py (YUK-50, YUK-51)."""

from __future__ import annotations

import subprocess
import threading
import time
from pathlib import Path

import pytest

from mlflow.playground.worker import (
    create_worker_worktree,
    prune_worker_worktree,
)


def _init_git_repo(repo_dir: Path) -> None:
    subprocess.check_call(["git", "init", "-b", "agent-playground"], cwd=repo_dir)
    subprocess.check_call(["git", "config", "user.email", "test@example.com"], cwd=repo_dir)
    subprocess.check_call(["git", "config", "user.name", "test"], cwd=repo_dir)
    (repo_dir / "README.md").write_text("seed\n")
    subprocess.check_call(["git", "add", "."], cwd=repo_dir)
    subprocess.check_call(["git", "commit", "-m", "seed"], cwd=repo_dir)


def test_create_worker_worktree_returns_path_branch_and_base(tmp_path):
    _init_git_repo(tmp_path)
    result = create_worker_worktree(tmp_path, "iss-abc")

    assert result.worktree_path == (tmp_path / ".mlflow" / "worktrees" / "iss-abc").resolve()
    assert result.worktree_path.is_dir()
    assert result.branch == "worker/iss-abc"
    assert result.base_branch == "agent-playground"
    # base_commit is a 40-char hex SHA.
    assert len(result.base_commit) == 40
    assert all(c in "0123456789abcdef" for c in result.base_commit)

    # Inside the worktree, HEAD should be on the worker branch.
    head = subprocess.check_output(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=result.worktree_path, text=True
    ).strip()
    assert head == "worker/iss-abc"


def test_create_worker_worktree_refuses_existing_path(tmp_path):
    _init_git_repo(tmp_path)
    create_worker_worktree(tmp_path, "iss-abc")
    with pytest.raises(FileExistsError, match="already exists"):
        create_worker_worktree(tmp_path, "iss-abc")


def test_prune_worker_worktree_removes_path_and_branch(tmp_path):
    _init_git_repo(tmp_path)
    create_worker_worktree(tmp_path, "iss-abc")
    worktree_path = tmp_path / ".mlflow" / "worktrees" / "iss-abc"
    assert worktree_path.is_dir()

    prune_worker_worktree(tmp_path, "iss-abc", force=True)

    assert not worktree_path.exists()
    branches = subprocess.check_output(["git", "branch"], cwd=tmp_path, text=True)
    assert "worker/iss-abc" not in branches


def test_prune_worker_worktree_idempotent_on_unknown_issue(tmp_path):
    _init_git_repo(tmp_path)
    # No worktree was ever created — pruning should be a no-op, not raise.
    prune_worker_worktree(tmp_path, "iss-never-existed")


# ---------------------------------------------------------------------------
# Claude dispatch (YUK-51)
# ---------------------------------------------------------------------------


def test_build_claude_fix_prompt_includes_issue_and_test(monkeypatch):
    from unittest import mock

    import pandas as pd

    from mlflow.playground import worker

    issue = mock.Mock(
        name="bad-tone",
        description="Tone too casual",
        source_trace_id="tr-1",
        test_case_id="tc-1",
        experiment_id="0",
    )
    issue.name = "Tone too casual for compliance"
    dataset = mock.Mock()
    dataset.to_df.return_value = pd.DataFrame([
        {
            "inputs": {"messages": [{"role": "user", "content": "Hi"}]},
            "expectations": {
                "test_spec": {"strategy": "assertion", "assertions": ["formal tone"]},
                "expected_response": "We use formal tone.",
            },
            "tags": {"issue_id": "iss-1"},
        }
    ])

    with (
        mock.patch(
            "mlflow.tracking._tracking_service.utils._get_store",
            return_value=mock.Mock(get_issue=mock.Mock(return_value=issue)),
        ),
        mock.patch(
            "mlflow.playground.regression_suite.get_or_create_regression_dataset",
            return_value=dataset,
        ),
    ):
        prompt = worker.build_claude_fix_prompt("iss-1")

    assert "iss-1" in prompt
    assert "Tone too casual for compliance" in prompt
    assert "formal tone" in prompt
    assert "mlflow agent test run --issue iss-1" in prompt
    assert "tr-1" in prompt


def _fake_claude_popen(*, returncode: int = 0, lines: list[str] | None = None):
    """Build a Mock that quacks like ``subprocess.Popen`` for streaming claude.

    `lines` are yielded one-by-one from `proc.stdout` to mimic stream-json
    output; pass `None` for an empty stream (claude exits without printing).
    """
    from unittest import mock

    proc = mock.Mock()
    proc.stdout = iter(lines or [])
    proc.returncode = returncode
    proc.poll = mock.Mock(return_value=returncode)
    proc.wait = mock.Mock(return_value=returncode)
    proc.kill = mock.Mock()
    return proc


def test_dispatch_claude_fix_marks_failed_when_claude_missing(tmp_path, monkeypatch):
    """The worktree-local agent now spins up *before* Claude (so its
    nested `mlflow agent test run` calls hit code that reflects Claude's
    edits). Mock that launch out so the test still exercises only the
    claude-missing branch.
    """
    from unittest import mock

    from mlflow.playground import worker
    from mlflow.playground.server import AgentConnection, PlaygroundRuntime, _new_connection_id

    runtime = PlaygroundRuntime()
    conn = AgentConnection(
        connection_id=_new_connection_id(),
        name="probe",
        agent_url="",
        status="pending",
    )
    runtime.connections[conn.connection_id] = conn

    agent_proc = mock.Mock()
    with (
        mock.patch("mlflow.playground.worker.build_claude_fix_prompt", return_value="hi"),
        mock.patch("mlflow.playground.server._launch_local_agent_process", return_value=agent_proc),
        mock.patch("mlflow.playground.server._wait_for_agent_health", return_value=True),
        mock.patch("mlflow.playground.worker._find_free_port", return_value=12345),
        mock.patch(
            "mlflow.playground.worker.subprocess.Popen",
            side_effect=FileNotFoundError("no claude"),
        ),
    ):
        thread = worker.dispatch_claude_fix(
            runtime,
            issue_id="iss-1",
            connection_id=conn.connection_id,
            worktree_path=tmp_path,
        )
        thread.join(timeout=5.0)

    assert conn.status == "failed"
    assert "claude CLI not found" in (conn.status_message or "")


def test_dispatch_claude_fix_marks_failed_when_test_still_red(tmp_path, monkeypatch):
    from unittest import mock

    from mlflow.playground import worker
    from mlflow.playground.server import AgentConnection, PlaygroundRuntime, _new_connection_id

    runtime = PlaygroundRuntime()
    conn = AgentConnection(
        connection_id=_new_connection_id(),
        name="probe",
        agent_url="",
        status="pending",
    )
    runtime.connections[conn.connection_id] = conn

    claude_proc = _fake_claude_popen(returncode=0)
    test_proc = mock.Mock(returncode=1, stdout="assertion failed", stderr="")
    agent_proc = mock.Mock()
    with (
        mock.patch("mlflow.playground.worker.build_claude_fix_prompt", return_value="hi"),
        mock.patch("mlflow.playground.server._launch_local_agent_process", return_value=agent_proc),
        mock.patch("mlflow.playground.server._wait_for_agent_health", return_value=True),
        mock.patch("mlflow.playground.worker._find_free_port", return_value=12345),
        mock.patch("mlflow.playground.worker.subprocess.Popen", return_value=claude_proc),
        mock.patch("mlflow.playground.worker.subprocess.run", return_value=test_proc),
    ):
        thread = worker.dispatch_claude_fix(
            runtime,
            issue_id="iss-1",
            connection_id=conn.connection_id,
            worktree_path=tmp_path,
        )
        thread.join(timeout=5.0)

    assert conn.status == "failed"
    assert "still red" in (conn.status_message or "")


def test_dispatch_claude_fix_happy_path(tmp_path, monkeypatch):
    from unittest import mock

    from mlflow.playground import worker
    from mlflow.playground.server import AgentConnection, PlaygroundRuntime, _new_connection_id

    runtime = PlaygroundRuntime()
    conn = AgentConnection(
        connection_id=_new_connection_id(),
        name="probe",
        agent_url="",
        status="pending",
    )
    runtime.connections[conn.connection_id] = conn

    claude_proc = _fake_claude_popen(returncode=0)
    test_proc = mock.Mock(returncode=0, stdout="PASS", stderr="")
    agent_proc = mock.Mock()
    store = mock.Mock(transition_issue=mock.Mock())

    with (
        mock.patch("mlflow.playground.worker.build_claude_fix_prompt", return_value="hi"),
        mock.patch("mlflow.playground.worker.subprocess.Popen", return_value=claude_proc),
        mock.patch("mlflow.playground.worker.subprocess.run", return_value=test_proc),
        mock.patch("mlflow.playground.server._launch_local_agent_process", return_value=agent_proc),
        mock.patch("mlflow.playground.server._wait_for_agent_health", return_value=True),
        mock.patch("mlflow.playground.worker._find_free_port", return_value=12345),
        mock.patch("mlflow.tracking._tracking_service.utils._get_store", return_value=store),
    ):
        thread = worker.dispatch_claude_fix(
            runtime,
            issue_id="iss-1",
            connection_id=conn.connection_id,
            worktree_path=tmp_path,
        )
        thread.join(timeout=5.0)

    assert conn.status == "ready"
    assert conn.agent_url == "http://127.0.0.1:12345"
    assert conn.process is agent_proc
    store.transition_issue.assert_called_once()


def test_dispatch_claude_fix_points_claude_at_worktree_local_agent(tmp_path, monkeypatch):
    """Regression for the "Claude tests against parent agent" bug:
    `_run_claude` must receive `MLFLOW_PLAYGROUND_AGENT_URL` set to the
    worktree-local agent's URL, otherwise nested `mlflow agent test run`
    calls fall back to the parent project's main agent on 127.0.0.1:8000
    and Claude iterates blindly against unedited code.
    """
    from unittest import mock

    from mlflow.playground import worker
    from mlflow.playground.server import AgentConnection, PlaygroundRuntime, _new_connection_id

    runtime = PlaygroundRuntime()
    conn = AgentConnection(
        connection_id=_new_connection_id(),
        name="probe",
        agent_url="",
        status="pending",
    )
    runtime.connections[conn.connection_id] = conn

    claude_proc = _fake_claude_popen(returncode=0)
    test_proc = mock.Mock(returncode=0, stdout="PASS", stderr="")
    agent_proc = mock.Mock()
    store = mock.Mock(transition_issue=mock.Mock())

    with (
        mock.patch("mlflow.playground.worker.build_claude_fix_prompt", return_value="hi"),
        mock.patch("mlflow.playground.server._launch_local_agent_process", return_value=agent_proc),
        mock.patch("mlflow.playground.server._wait_for_agent_health", return_value=True),
        mock.patch("mlflow.playground.worker._find_free_port", return_value=54321),
        mock.patch("mlflow.playground.worker.subprocess.Popen", return_value=claude_proc) as popen,
        mock.patch("mlflow.playground.worker.subprocess.run", return_value=test_proc) as run,
        mock.patch("mlflow.tracking._tracking_service.utils._get_store", return_value=store),
    ):
        thread = worker.dispatch_claude_fix(
            runtime,
            issue_id="iss-1",
            connection_id=conn.connection_id,
            worktree_path=tmp_path,
        )
        thread.join(timeout=5.0)

    # Claude's subprocess env carries the worktree-local URL.
    env = popen.call_args.kwargs["env"]
    assert env["MLFLOW_PLAYGROUND_AGENT_URL"] == "http://127.0.0.1:54321"
    # The final regression test (subprocess.run) gets the same URL.
    env = run.call_args.kwargs["env"]
    assert env["MLFLOW_PLAYGROUND_AGENT_URL"] == "http://127.0.0.1:54321"
    # And the connection settles on the same process the dispatcher launched
    # pre-claude — no second agent launch.
    assert conn.process is agent_proc


def test_run_claude_streams_events_into_comments(tmp_path):
    from unittest import mock

    from mlflow.playground import worker

    lines = [
        '{"type":"system","subtype":"init","model":"claude-sonnet-4-6"}\n',
        (
            '{"type":"assistant","message":{"content":'
            '[{"type":"text","text":"Investigating the issue."}]}}\n'
        ),
        (
            '{"type":"assistant","message":{"content":'
            '[{"type":"tool_use","name":"Read","input":{"file_path":"/x/agent.py"}}]}}\n'
        ),
        (
            '{"type":"result","subtype":"success",'
            '"num_turns":3,"duration_ms":4200,"total_cost_usd":0.0123}\n'
        ),
    ]
    fake_proc = _fake_claude_popen(returncode=0, lines=lines)
    store = mock.Mock(add_issue_comment=mock.Mock())

    with (
        mock.patch("mlflow.playground.worker.subprocess.Popen", return_value=fake_proc),
        mock.patch("mlflow.tracking._tracking_service.utils._get_store", return_value=store),
    ):
        exit_code, error = worker._run_claude(
            tmp_path,
            "prompt",
            tmp_path / "claude.log",
            issue_id="iss-1",
        )

    assert exit_code == 0
    assert error == ""
    bodies = [
        call.kwargs.get("body") or call.args[1] for call in store.add_issue_comment.mock_calls
    ]
    assert any("Investigating the issue" in b for b in bodies)
    assert any(b.startswith("→ Read(") for b in bodies)
    assert any("claude finished" in b for b in bodies)
    # Raw stream landed on disk too.
    assert (tmp_path / "claude.log").read_text().count("\n") == len(lines)


# ---------------------------------------------------------------------------
# Cancel / discard mid-claude
# ---------------------------------------------------------------------------


def test_run_claude_invokes_on_proc_started_before_streaming(tmp_path):
    """The callback must fire BEFORE _run_claude blocks on stdout — otherwise a
    discard issued the instant Popen returns can't find a process to kill.
    """
    from unittest import mock

    from mlflow.playground import worker

    order: list[str] = []

    def _record_iter(lines):
        # Iterator that appends to `order` the moment it's consumed; that's
        # how we detect when _run_claude started reading stdout vs. when the
        # callback fired.
        def _gen():
            order.append("stdout-read")
            for line in lines:
                yield line

        return _gen()

    fake_proc = mock.Mock()
    fake_proc.stdout = _record_iter(['{"type":"result","subtype":"success"}\n'])
    fake_proc.returncode = 0
    fake_proc.poll = mock.Mock(return_value=0)
    fake_proc.wait = mock.Mock(return_value=0)
    fake_proc.kill = mock.Mock()

    def _on_started(proc):
        assert proc is fake_proc
        order.append("on-started")

    with mock.patch("mlflow.playground.worker.subprocess.Popen", return_value=fake_proc):
        exit_code, _ = worker._run_claude(
            tmp_path,
            "prompt",
            tmp_path / "claude.log",
            on_proc_started=_on_started,
        )

    assert exit_code == 0
    # Callback must run before stdout is consumed.
    assert order == ["on-started", "stdout-read"]


def test_discard_mid_claude_kills_subprocess_and_aborts_dispatch(tmp_path):
    """End-to-end test of the cancel path: while _run_claude is blocked
    streaming stdout, another thread calls discard_worker_connection. The
    Claude subprocess must be terminated, the connection removed from the
    runtime, and the dispatch must NOT proceed to the regression-test stage.
    """
    from unittest import mock

    from mlflow.playground import worker
    from mlflow.playground.server import AgentConnection, PlaygroundRuntime, _new_connection_id

    runtime = PlaygroundRuntime()
    runtime.repo_dir = tmp_path  # so discard tries to prune; we mock prune
    conn = AgentConnection(
        connection_id=_new_connection_id(),
        name="probe",
        agent_url="",
        status="pending",
        source_issue_id="iss-1",
    )
    runtime.connections[conn.connection_id] = conn

    # `stdout` is a generator that blocks on `release.wait()` the first time
    # the dispatch thread pulls from it. The `yield` is unreachable but makes
    # Python treat this as a generator function — calling it returns an
    # iterator whose body doesn't execute until consumed.
    release = threading.Event()

    def _blocking_stdout():
        # The dispatch thread blocks here, inside `for raw_line in proc.stdout`,
        # until discard's terminate() sets `release`. Returning ends the
        # iterator (StopIteration) which mimics SIGTERM closing the pipe.
        release.wait(timeout=5.0)
        return
        yield  # unreachable, present only to make this a generator function

    fake_proc = mock.Mock()
    fake_proc.stdout = _blocking_stdout()
    fake_proc.returncode = -15  # SIGTERM
    # `poll()` must return None until terminate() fires — otherwise
    # _terminate_process short-circuits before sending the signal because it
    # thinks the proc is already dead.
    fake_proc.poll = mock.Mock(side_effect=lambda: -15 if release.is_set() else None)
    fake_proc.wait = mock.Mock(return_value=-15)
    # _terminate_process calls terminate() then wait(timeout=5). Make
    # `terminate` release the stdout iterator so the dispatch thread unblocks.
    fake_proc.terminate = mock.Mock(side_effect=lambda: release.set())
    fake_proc.kill = mock.Mock()

    # Track whether the regression-test path runs — discard must prevent it.
    test_run = mock.Mock()

    # Worktree-local agent now spins up before Claude. Mock it out so the
    # discard path under test gets to actually exercise mid-Claude
    # cancellation.
    agent_proc = mock.Mock()
    with (
        mock.patch("mlflow.playground.worker.build_claude_fix_prompt", return_value="hi"),
        mock.patch("mlflow.playground.server._launch_local_agent_process", return_value=agent_proc),
        mock.patch("mlflow.playground.server._wait_for_agent_health", return_value=True),
        mock.patch("mlflow.playground.worker._find_free_port", return_value=12345),
        mock.patch("mlflow.playground.worker.subprocess.Popen", return_value=fake_proc),
        mock.patch("mlflow.playground.worker.subprocess.run", side_effect=test_run),
        mock.patch("mlflow.playground.worker.prune_worker_worktree"),
    ):
        thread = worker.dispatch_claude_fix(
            runtime,
            issue_id="iss-1",
            connection_id=conn.connection_id,
            worktree_path=tmp_path,
        )
        # Spin until the dispatcher's on_proc_started callback has registered
        # the Popen on the connection. Bounded loop with a generous total
        # budget; if this times out the registration plumbing is broken.
        deadline = time.time() + 5.0
        while conn.process is not fake_proc and time.time() < deadline:
            time.sleep(0.01)
        assert conn.process is fake_proc, "dispatcher never registered the Claude proc"

        result = worker.discard_worker_connection(runtime, conn.connection_id)
        assert result == {"connection_id": conn.connection_id, "discarded": True}

        thread.join(timeout=5.0)
        assert not thread.is_alive(), "dispatch thread did not exit after discard"

    fake_proc.terminate.assert_called_once()
    test_run.assert_not_called()  # regression test must NOT have run
    assert conn.connection_id not in runtime.connections


def test_discard_after_claude_returns_naturally_does_not_kill_again(tmp_path):
    """If Claude finishes on its own, connection.process is cleared by the
    dispatcher. A subsequent discard must still succeed and not try to kill
    the dead PID (which would raise).
    """
    from unittest import mock

    from mlflow.playground import worker
    from mlflow.playground.server import AgentConnection, PlaygroundRuntime, _new_connection_id

    runtime = PlaygroundRuntime()
    runtime.repo_dir = tmp_path
    conn = AgentConnection(
        connection_id=_new_connection_id(),
        name="probe",
        agent_url="",
        status="failed",  # simulate post-dispatch state with a failed run
        source_issue_id="iss-1",
    )
    runtime.connections[conn.connection_id] = conn

    # `process` is None because the dispatcher cleared it after _run_claude.
    assert conn.process is None

    fake_terminate = mock.Mock()
    with (
        mock.patch("mlflow.playground.worker.prune_worker_worktree"),
        mock.patch("mlflow.playground.server._terminate_process", fake_terminate),
    ):
        result = worker.discard_worker_connection(runtime, conn.connection_id)

    assert result == {"connection_id": conn.connection_id, "discarded": True}
    # No process to kill — _terminate_process is never reached.
    fake_terminate.assert_not_called()
    assert conn.connection_id not in runtime.connections
