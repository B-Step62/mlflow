from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from mlflow.server.playground_api import create_playground_api_router


def create_test_client():
    app = FastAPI()
    app.include_router(create_playground_api_router())
    return TestClient(app)


def test_playground_config_endpoint_returns_agent_status():
    client = create_test_client()

    with (
        mock.patch("mlflow.server.playground_api._ensure_agent_running", return_value=False),
        mock.patch("mlflow.server.playground_api._is_agent_healthy_sync", return_value=False),
    ):
        response = client.get("/ajax-api/3.0/mlflow/playground/config")

    assert response.status_code == 200
    assert response.json()["agent_url"] == "http://127.0.0.1:8000"
    assert response.json()["agent_connected"] is False


def test_playground_probe_endpoint_updates_agent_url():
    client = create_test_client()

    with (
        mock.patch("mlflow.server.playground_api._ensure_agent_running", return_value=True),
        mock.patch("mlflow.server.playground_api._is_agent_healthy_sync", return_value=True),
    ):
        response = client.post(
            "/ajax-api/3.0/mlflow/playground/config",
            json={"agent_url": "http://127.0.0.1:9000"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "connected": True,
        "agent_url": "http://127.0.0.1:9000",
    }


def test_playground_chat_endpoint_requires_messages():
    client = create_test_client()

    response = client.post("/ajax-api/3.0/mlflow/playground/chat", json={"messages": []})

    assert response.status_code == 400
    assert "non-empty list" in response.json()["detail"]
