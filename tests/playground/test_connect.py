"""Unit tests for ``mlflow agent connect`` (YUK-48)."""

from __future__ import annotations

import socket
from pathlib import Path
from unittest import mock

import pytest

from mlflow.playground import connect as connect_mod


def test_find_free_port_returns_available_int():
    port = connect_mod._find_free_port()
    assert isinstance(port, int)
    assert 1024 <= port < 65536
    # Bind sanity-check: the port should be re-bindable immediately.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", port))


def test_register_posts_expected_body_and_returns_connection_id():
    response = mock.Mock()
    response.json.return_value = {"connection_id": "conn-abc"}
    with mock.patch("mlflow.playground.connect.httpx.post", return_value=response) as post:
        cid = connect_mod._register(
            "http://127.0.0.1:5001/",
            name="fix-iss-x-1",
            agent_url="http://127.0.0.1:9001",
            repo_dir=Path("/tmp/agent"),
            source_issue="iss-x",
            branch="worker/iss-x",
            base_commit="cafef00d",
        )

    assert cid == "conn-abc"
    post.assert_called_once()
    url, kwargs = post.call_args[0][0], post.call_args[1]
    assert url == "http://127.0.0.1:5001/ajax-api/3.0/mlflow/playground/agent-connections/register"
    assert kwargs["json"] == {
        "name": "fix-iss-x-1",
        "agent_url": "http://127.0.0.1:9001",
        "repo_dir": "/tmp/agent",
        "status": "ready",
        "source_issue_id": "iss-x",
        "branch": "worker/iss-x",
        "base_commit": "cafef00d",
    }


def test_register_omits_optional_fields_when_missing():
    response = mock.Mock()
    response.json.return_value = {"connection_id": "conn-bare"}
    with mock.patch("mlflow.playground.connect.httpx.post", return_value=response) as post:
        connect_mod._register(
            "http://127.0.0.1:5000",
            name="bare",
            agent_url="http://127.0.0.1:9000",
            repo_dir=Path("/tmp/x"),
            source_issue=None,
            branch=None,
            base_commit=None,
        )

    body = post.call_args[1]["json"]
    assert "source_issue_id" not in body
    assert "branch" not in body
    assert "base_commit" not in body


def test_deregister_swallows_errors():
    with mock.patch("mlflow.playground.connect.httpx.delete", side_effect=Exception("boom")):
        connect_mod._deregister("http://127.0.0.1:5000", "conn-xyz")  # must not raise


def test_run_connect_full_happy_path(tmp_path: Path):
    """End-to-end mock test: Popen + wait_for_health + register + wait + cleanup."""
    process = mock.Mock()
    process.wait.return_value = 0  # clean exit

    register_response = mock.Mock()
    register_response.json.return_value = {"connection_id": "conn-happy"}
    register_response.raise_for_status = mock.Mock()

    with (
        mock.patch(
            "mlflow.playground.connect._launch_local_agent_process", return_value=process
        ) as launch,
        mock.patch(
            "mlflow.playground.connect._wait_for_agent_health", return_value=True
        ) as wait_health,
        mock.patch("mlflow.playground.connect.httpx.post", return_value=register_response) as post,
        mock.patch("mlflow.playground.connect.httpx.delete") as delete,
        mock.patch("mlflow.playground.connect.get_git_branch", return_value="agent-playground"),
        mock.patch("mlflow.playground.connect.get_git_commit", return_value="abc123"),
        mock.patch("mlflow.playground.connect._terminate_process") as terminate,
        mock.patch("mlflow.playground.connect.signal.signal"),
    ):
        connect_mod.run_connect(
            playground_url="http://127.0.0.1:5001",
            name="probe",
            source_issue=None,
            port=9001,
            repo_dir=tmp_path,
        )

    launch.assert_called_once_with(tmp_path.resolve(), "http://127.0.0.1:9001")
    wait_health.assert_called_once()
    post.assert_called_once()
    process.wait.assert_called_once()
    # Cleanup should run exactly once even though it's wired into both
    # process.wait completion and the finally clause.
    assert delete.call_count == 1
    assert terminate.call_count == 1


def test_run_connect_raises_when_agent_unhealthy(tmp_path: Path):
    process = mock.Mock()

    with (
        mock.patch("mlflow.playground.connect._launch_local_agent_process", return_value=process),
        mock.patch("mlflow.playground.connect._wait_for_agent_health", return_value=False),
        mock.patch("mlflow.playground.connect._terminate_process") as terminate,
    ):
        with pytest.raises(Exception, match="did not become healthy"):
            connect_mod.run_connect(
                playground_url="http://127.0.0.1:5001",
                name="dud",
                source_issue=None,
                port=9001,
                repo_dir=tmp_path,
            )

    terminate.assert_called_once_with(process)


def test_run_connect_raises_on_register_failure(tmp_path: Path):
    import httpx

    process = mock.Mock()
    response = mock.Mock()
    response.raise_for_status = mock.Mock(side_effect=httpx.HTTPError("conflict"))

    with (
        mock.patch("mlflow.playground.connect._launch_local_agent_process", return_value=process),
        mock.patch("mlflow.playground.connect._wait_for_agent_health", return_value=True),
        mock.patch("mlflow.playground.connect.httpx.post", return_value=response),
        mock.patch("mlflow.playground.connect.get_git_branch", return_value=None),
        mock.patch("mlflow.playground.connect.get_git_commit", return_value=None),
        mock.patch("mlflow.playground.connect._terminate_process") as terminate,
    ):
        with pytest.raises(Exception, match="Failed to register"):
            connect_mod.run_connect(
                playground_url="http://127.0.0.1:5001",
                name="dud",
                source_issue=None,
                port=9001,
                repo_dir=tmp_path,
            )

    terminate.assert_called_once_with(process)


def test_run_connect_picks_free_port_when_zero(tmp_path: Path):
    process = mock.Mock()
    process.wait.return_value = 0
    register_response = mock.Mock()
    register_response.json.return_value = {"connection_id": "conn-z"}

    with (
        mock.patch(
            "mlflow.playground.connect._launch_local_agent_process", return_value=process
        ) as launch,
        mock.patch("mlflow.playground.connect._wait_for_agent_health", return_value=True),
        mock.patch("mlflow.playground.connect.httpx.post", return_value=register_response),
        mock.patch("mlflow.playground.connect.httpx.delete"),
        mock.patch("mlflow.playground.connect.get_git_branch", return_value=None),
        mock.patch("mlflow.playground.connect.get_git_commit", return_value=None),
        mock.patch("mlflow.playground.connect._terminate_process"),
        mock.patch("mlflow.playground.connect.signal.signal"),
        mock.patch("mlflow.playground.connect._find_free_port", return_value=54321) as ffp,
    ):
        connect_mod.run_connect(
            playground_url="http://127.0.0.1:5001",
            name="probe",
            source_issue=None,
            port=0,
            repo_dir=tmp_path,
        )

    ffp.assert_called_once()
    launch.assert_called_once_with(tmp_path.resolve(), "http://127.0.0.1:54321")
