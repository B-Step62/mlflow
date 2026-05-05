"""End-to-end smoke for the Epic 8 worker fix loop (YUK-56).

Walks the full REST surface: dispatch-worker → connection becomes ready →
activate → accept → main bounces. The heavy bits are mocked:

* `claude` invocation (no CLI assumed in CI).
* The user's agent process (we don't actually start a webserver).
* The tracking store (in-memory mock — issue state machine is exercised).
* `mlflow agent test run` (mocked to return 0).

This checks the WIRING — that each REST endpoint flows into the connection
registry + state machine in the right order. The unit tests in
``test_worker.py`` cover the individual pieces.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from unittest import mock

# Match test_api.py — tests don't want the daemon health-poll thread.
os.environ["MLFLOW_PLAYGROUND_DISABLE_HEALTH_POLL"] = "1"

from fastapi import FastAPI
from fastapi.testclient import TestClient

from mlflow.server.playground_api import create_playground_api_router

_CONN_BASE = "/ajax-api/3.0/mlflow/playground/agent-connections"


def _init_git_repo(repo_dir: Path) -> None:
    subprocess.check_call(["git", "init", "-b", "agent-playground"], cwd=repo_dir)
    subprocess.check_call(["git", "config", "user.email", "test@example.com"], cwd=repo_dir)
    subprocess.check_call(["git", "config", "user.name", "test"], cwd=repo_dir)
    (repo_dir / "agent.py").write_text("# placeholder agent\n")
    subprocess.check_call(["git", "add", "."], cwd=repo_dir)
    subprocess.check_call(["git", "commit", "-m", "seed"], cwd=repo_dir)


def _client_with_repo(tmp_path: Path) -> TestClient:
    with mock.patch("mlflow.server.playground_api._resolve_repo_dir", return_value=tmp_path):
        app = FastAPI()
        app.include_router(create_playground_api_router())
        return TestClient(app)


def test_e2e_dispatch_to_accept(tmp_path: Path):
    from mlflow.entities.issue import IssueStatus

    _init_git_repo(tmp_path)
    base_commit = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=tmp_path, text=True
    ).strip()

    issue = mock.Mock(
        status=IssueStatus.TODO,
        source_trace_id=None,
        test_case_id=None,
        experiment_id="0",
    )
    issue.name = "agent says wrong thing"
    issue.description = "must say hello"
    transitions: list[tuple[str, str]] = []

    def fake_transition(issue_id: str, status: IssueStatus, assignee: str | None = None):
        transitions.append((issue_id, status.value))
        issue.status = status
        return issue

    store = mock.Mock(get_issue=mock.Mock(return_value=issue), transition_issue=fake_transition)

    agent_proc = mock.Mock()
    agent_proc.poll.return_value = None  # alive

    # Simulate Claude making a commit in the worker's worktree once the
    # placeholder is laid down. We hook _run_claude to write+commit, so the
    # subsequent merge in accept actually advances base HEAD.
    def fake_run_claude(worktree_path: Path, *_args, **_kwargs):
        (worktree_path / "fix.py").write_text("# fixed by worker\n")
        subprocess.check_call(["git", "add", "fix.py"], cwd=worktree_path)
        subprocess.check_call(["git", "commit", "-m", "worker fix"], cwd=worktree_path)
        return (0, "")

    with (
        mock.patch("mlflow.tracking._tracking_service.utils._get_store", return_value=store),
        mock.patch("mlflow.playground.worker._run_claude", side_effect=fake_run_claude),
        mock.patch("mlflow.playground.worker._run_final_test", return_value=(True, "PASS")),
        mock.patch("mlflow.playground.server._launch_local_agent_process", return_value=agent_proc),
        mock.patch("mlflow.playground.server._wait_for_agent_health", return_value=True),
    ):
        client = _client_with_repo(tmp_path)

        # 1. Dispatch.
        dispatch = client.post("/ajax-api/3.0/mlflow/playground/issues/iss-x/dispatch-worker")
        assert dispatch.status_code == 200, dispatch.text
        connection_id = dispatch.json()["connection_id"]
        assert dispatch.json()["base_commit"] == base_commit

        # 2. Wait for the worker thread to flip the connection ready.
        import time

        for _ in range(50):
            listing = client.get(_CONN_BASE).json()
            workers = [c for c in listing["connections"] if c["connection_id"] == connection_id]
            if workers and workers[0]["status"] == "ready":
                break
            time.sleep(0.05)
        else:
            raise AssertionError(f"Worker did not become ready: {client.get(_CONN_BASE).json()}")

        # Issue should now be in `review`.
        assert ("iss-x", "in_progress") in transitions
        assert ("iss-x", "review") in transitions

        # 3. Activate the worker connection (chat would now route to it).
        activated = client.post(f"{_CONN_BASE}/{connection_id}/activate")
        assert activated.status_code == 200
        assert client.get(_CONN_BASE).json()["active_connection_id"] == connection_id

        # 4. Accept — merge worker branch, transition issue to done, prune.
        with mock.patch("mlflow.playground.server._ensure_agent_running", return_value=False):
            accept = client.post(f"{_CONN_BASE}/{connection_id}/accept")
        assert accept.status_code == 200, accept.text
        body = accept.json()
        assert body["issue_status"] == "done"
        assert len(body["merge_commit"]) == 40

        # Issue transitions: todo → in_progress → review → done.
        statuses = [s for _, s in transitions if _ == "iss-x"]
        assert statuses == ["in_progress", "review", "done"]

        # Worker connection gone; main fell back to active.
        listing = client.get(_CONN_BASE).json()
        worker_left = [c for c in listing["connections"] if c["connection_id"] == connection_id]
        assert worker_left == []
        active = listing["active_connection_id"]
        names = {c["connection_id"]: c["name"] for c in listing["connections"]}
        assert names.get(active) == "main"

        # Worker branch pruned.
        branches = subprocess.check_output(["git", "branch"], cwd=tmp_path, text=True)
        assert "worker/iss-x" not in branches
        # And merge created exactly one new commit on the base branch.
        new_head = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=tmp_path, text=True
        ).strip()
        assert new_head != base_commit
