"""Unit tests for worker.py (YUK-50, YUK-51)."""

from __future__ import annotations

import subprocess
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


def test_dispatch_claude_fix_marks_failed_when_claude_missing(tmp_path, monkeypatch):
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

    with (
        mock.patch("mlflow.playground.worker.build_claude_fix_prompt", return_value="hi"),
        mock.patch(
            "mlflow.playground.worker.subprocess.run",
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

    # First subprocess.run = claude (exits 0). Second = mlflow agent test run (exits 1).
    claude_proc = mock.Mock(returncode=0)
    test_proc = mock.Mock(returncode=1, stdout="assertion failed", stderr="")
    with (
        mock.patch("mlflow.playground.worker.build_claude_fix_prompt", return_value="hi"),
        mock.patch(
            "mlflow.playground.worker.subprocess.run",
            side_effect=[claude_proc, test_proc],
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

    claude_proc = mock.Mock(returncode=0)
    test_proc = mock.Mock(returncode=0, stdout="PASS", stderr="")
    agent_proc = mock.Mock()
    store = mock.Mock(transition_issue=mock.Mock())

    with (
        mock.patch("mlflow.playground.worker.build_claude_fix_prompt", return_value="hi"),
        mock.patch(
            "mlflow.playground.worker.subprocess.run",
            side_effect=[claude_proc, test_proc],
        ),
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
