from click.testing import CliRunner
from fastapi.testclient import TestClient

from mlflow.playground import server
from mlflow.playground.cli import agent_commands
from mlflow.playground.server import build_url, create_app, pick_free_port


def test_create_app_serves_placeholder():
    client = TestClient(create_app())

    r = client.get("/playground")
    assert r.status_code == 200
    assert "MLflow Agent Playground" in r.text
    assert "Epic 2" in r.text  # placeholder message references the next epic

    r = client.get("/")
    assert r.status_code == 200

    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "stage": "epic-1-placeholder"}


def test_pick_free_port_returns_int():
    port = pick_free_port("127.0.0.1")
    assert isinstance(port, int)
    assert port > 0


def test_build_url_format():
    assert build_url("127.0.0.1", 8765) == "http://127.0.0.1:8765/playground"


def test_cli_playground_invokes_serve(monkeypatch):
    captured = {}

    def fake_serve(host, port, open_browser, reload):
        captured.update(host=host, port=port, open_browser=open_browser, reload=reload)

    monkeypatch.setattr(server, "serve", fake_serve)

    runner = CliRunner()
    result = runner.invoke(
        agent_commands,
        ["playground", "--no-browser", "--port", "8765", "--host", "0.0.0.0"],
    )
    assert result.exit_code == 0, result.output
    assert captured == {
        "host": "0.0.0.0",
        "port": 8765,
        "open_browser": False,
        "reload": False,
    }


def test_cli_playground_reload_flag(monkeypatch):
    captured = {}
    monkeypatch.setattr(server, "serve", lambda **kw: captured.update(kw))

    runner = CliRunner()
    result = runner.invoke(agent_commands, ["playground", "--no-browser", "--reload"])
    assert result.exit_code == 0
    assert captured["reload"] is True
