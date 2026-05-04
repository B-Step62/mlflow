from click.testing import CliRunner
from fastapi.testclient import TestClient
from unittest import mock

from mlflow.playground import server
from mlflow.claude_code.playground_setup import load_user_config
from mlflow.playground.cli import agent_commands
from mlflow.playground.server import (
    DEFAULT_AGENT_URL,
    PlaygroundRuntime,
    _ensure_local_playground_config,
    _build_agent_payload,
    _ensure_agent_running,
    _extract_assistant_text,
    _extract_trace_id,
    build_url,
    create_app,
    pick_free_port,
)


def test_create_app_serves_playground_shell():
    client = TestClient(create_app())

    r = client.get("/playground")
    assert r.status_code == 200
    assert "MLflow Agent Playground" in r.text
    assert "Live Trace Panel" in r.text
    assert "Send a turn to start the session" in r.text

    r = client.get("/")
    assert r.status_code == 200

    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "stage": "epic-2-demo"}


def test_config_endpoint_returns_defaults():
    client = TestClient(create_app())

    with (
        mock.patch("mlflow.playground.server._ensure_agent_running", return_value=False),
        mock.patch("mlflow.playground.server._is_agent_healthy_sync", return_value=False),
    ):
        response = client.get("/playground/api/config")
    assert response.status_code == 200
    assert response.json()["agent_url"] == DEFAULT_AGENT_URL
    assert response.json()["agent_connected"] is False


def test_chat_endpoint_requires_messages():
    client = TestClient(create_app())

    response = client.post("/playground/api/chat", json={"messages": []})
    assert response.status_code == 400
    assert "non-empty list" in response.json()["detail"]


def test_pick_free_port_returns_int():
    fake_socket = mock.MagicMock()
    fake_socket.getsockname.return_value = ("127.0.0.1", 43123)
    socket_factory = mock.MagicMock()
    socket_factory.return_value.__enter__.return_value = fake_socket

    with mock.patch("mlflow.playground.server.socket.socket", socket_factory):
        port = pick_free_port("127.0.0.1")

    assert port == 43123


def test_build_url_with_experiment():
    assert (
        build_url("127.0.0.1", 8765, "1")
        == "http://127.0.0.1:8765/#/experiments/1/playground"
    )


def test_build_url_without_experiment_falls_back_to_list():
    assert build_url("127.0.0.1", 8765, None) == "http://127.0.0.1:8765/#/experiments"


def test_cli_playground_invokes_serve(monkeypatch):
    captured = {}

    def fake_serve(host, port, open_browser, reload, agent_url):
        captured.update(
            host=host,
            port=port,
            open_browser=open_browser,
            reload=reload,
            agent_url=agent_url,
        )

    monkeypatch.setattr(server, "serve", fake_serve)

    runner = CliRunner()
    result = runner.invoke(
        agent_commands,
        [
            "playground",
            "--no-browser",
            "--port",
            "8765",
            "--host",
            "0.0.0.0",
            "--agent-url",
            "http://127.0.0.1:9000",
        ],
    )
    assert result.exit_code == 0, result.output
    assert captured == {
        "host": "0.0.0.0",
        "port": 8765,
        "open_browser": False,
        "reload": False,
        "agent_url": "http://127.0.0.1:9000",
    }


def test_cli_playground_reload_flag(monkeypatch):
    captured = {}
    monkeypatch.setattr(server, "serve", lambda **kw: captured.update(kw))

    runner = CliRunner()
    result = runner.invoke(agent_commands, ["playground", "--no-browser", "--reload"])
    assert result.exit_code == 0
    assert captured["reload"] is True


def test_extract_assistant_text_handles_responses_agent_payload():
    payload = {
        "output": [
            {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": "Hello from ResponsesAgent"}],
            }
        ],
        "metadata": {"trace_id": "tr-123"},
    }

    assert _extract_assistant_text(payload) == "Hello from ResponsesAgent"
    assert _extract_trace_id(payload) == "tr-123"


def test_extract_assistant_text_handles_simple_chat_payload():
    payload = {"role": "assistant", "content": "Hello from invoke"}
    assert _extract_assistant_text(payload) == "Hello from invoke"


def test_build_agent_payload_supports_both_protocols():
    messages = [{"role": "user", "content": "Hi"}]
    assert _build_agent_payload(messages, "messages") == {"messages": messages}
    assert _build_agent_payload(messages, "responses") == {"input": messages}


def test_ensure_agent_running_starts_local_bootstrap(tmp_path):
    runtime = PlaygroundRuntime(repo_dir=tmp_path)
    process = mock.Mock()
    process.poll.side_effect = [None]

    with (
        mock.patch("mlflow.playground.server._is_agent_healthy_sync", side_effect=[False, False, True]),
        mock.patch("mlflow.playground.server._launch_local_agent_process", return_value=process) as launch,
        mock.patch("mlflow.playground.server.atexit.register") as register,
    ):
        started = _ensure_agent_running(runtime, DEFAULT_AGENT_URL)

    assert started is True
    launch.assert_called_once_with(tmp_path, DEFAULT_AGENT_URL)
    register.assert_called_once()
    assert runtime.agent_process is process
    assert runtime.managed_agent_url == DEFAULT_AGENT_URL


def test_ensure_agent_running_skips_remote_urls(tmp_path):
    runtime = PlaygroundRuntime(repo_dir=tmp_path)

    with (
        mock.patch("mlflow.playground.server._is_agent_healthy_sync", return_value=False),
        mock.patch("mlflow.playground.server._launch_local_agent_process") as launch,
    ):
        started = _ensure_agent_running(runtime, "https://example.com")

    assert started is False
    launch.assert_not_called()


def test_ensure_local_playground_config_forces_local_tracking_uri(tmp_path):
    config_path = tmp_path / "config.yaml"
    repo_dir = tmp_path / "repo"
    repo_dir.mkdir()
    config_path.write_text(
        "\n".join(
            [
                "schema_version: 1",
                "mlflow:",
                "  tracking_uri: http://remote-server:5000",
                "  experiment: ''",
                "playground:",
                "  enable_tracing: true",
                "  repo_dir: ''",
            ]
        )
    )

    config = _ensure_local_playground_config(config_path=config_path, repo_dir=repo_dir)

    assert config.mlflow.tracking_uri.startswith("sqlite:///")
    assert config.mlflow.experiment == "agent-playground"
    assert config.playground.repo_dir == str(repo_dir.resolve())

    persisted = load_user_config(config_path)
    assert persisted is not None
    assert persisted.mlflow.tracking_uri == config.mlflow.tracking_uri
    assert persisted.playground.repo_dir == str(repo_dir.resolve())


def test_serve_runs_mlflow_server_with_local_env(monkeypatch, tmp_path):
    config_path = tmp_path / "config.yaml"
    repo_dir = tmp_path / "repo"
    repo_dir.mkdir()
    monkeypatch.chdir(repo_dir)
    monkeypatch.setattr(server, "DEFAULT_CONFIG_PATH", config_path)
    monkeypatch.setattr(server, "_ensure_mlflow_ui_assets", lambda: None)
    monkeypatch.setattr(server, "_default_artifact_root", lambda: "file:///tmp/playground-artifacts")
    monkeypatch.setattr(server.threading, "Thread", mock.Mock())

    captured = {}

    def fake_run_server(**kwargs):
        captured["kwargs"] = kwargs
        captured["tracking_uri"] = server.os.environ.get("MLFLOW_TRACKING_URI")
        captured["experiment_name"] = server.os.environ.get("MLFLOW_EXPERIMENT_NAME")
        captured["agent_url"] = server.os.environ.get("MLFLOW_PLAYGROUND_AGENT_URL")

    monkeypatch.setattr("mlflow.server._run_server", fake_run_server)

    server.serve(host="127.0.0.1", port=5012, open_browser=False, reload=False, agent_url=None)

    assert captured["kwargs"]["file_store_path"].startswith("sqlite:///")
    assert captured["kwargs"]["registry_store_uri"] == captured["kwargs"]["file_store_path"]
    assert captured["kwargs"]["host"] == "127.0.0.1"
    assert captured["kwargs"]["port"] == 5012
    assert captured["tracking_uri"] == captured["kwargs"]["file_store_path"]
    assert captured["experiment_name"] == "agent-playground"
    assert captured["agent_url"] == DEFAULT_AGENT_URL
