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


_DISPATCH_PATH = "/ajax-api/3.0/mlflow/playground/issues/dispatch"


def _valid_dispatch_payload(**overrides):
    base = {
        "rationale": "must mention §4.2 of the refund policy",
        "failing_assistant_message": "I'd be happy to help process your refund.",
        "conversation_prefix": [{"role": "user", "content": "How long do refunds take?"}],
        "experiment_id": "0",
        "source_trace_id": "tr-abc",
    }
    base.update(overrides)
    return base


def test_dispatch_returns_ids_on_success():
    client = create_test_client()
    expected = {
        "issue_id": "iss-1",
        "test_case_id": "tc-1",
        "dataset_name": "regression_suite_0",
    }
    with mock.patch(
        "mlflow.server.playground_api._dispatch_feedback",
        return_value=expected,
    ) as mock_dispatch:
        response = client.post(_DISPATCH_PATH, json=_valid_dispatch_payload())

    assert response.status_code == 200
    assert response.json() == expected
    mock_dispatch.assert_called_once()
    kwargs = mock_dispatch.call_args.kwargs
    assert kwargs["rationale"].startswith("must mention")
    assert kwargs["experiment_id"] == "0"
    assert kwargs["source_trace_id"] == "tr-abc"


def test_dispatch_rejects_blank_rationale():
    client = create_test_client()

    response = client.post(_DISPATCH_PATH, json=_valid_dispatch_payload(rationale="  "))

    assert response.status_code == 400
    assert "rationale" in response.json()["detail"]


def test_dispatch_rejects_non_list_conversation_prefix():
    client = create_test_client()

    response = client.post(
        _DISPATCH_PATH, json=_valid_dispatch_payload(conversation_prefix="hi")
    )

    assert response.status_code == 400
    assert "conversation_prefix" in response.json()["detail"]


def test_dispatch_translates_value_error_to_400():
    client = create_test_client()
    with mock.patch(
        "mlflow.server.playground_api._dispatch_feedback",
        side_effect=ValueError("experiment_id missing"),
    ):
        response = client.post(_DISPATCH_PATH, json=_valid_dispatch_payload(experiment_id=None))

    assert response.status_code == 400
    assert "experiment_id missing" in response.json()["detail"]


def test_dispatch_translates_unexpected_error_to_500():
    client = create_test_client()
    with mock.patch(
        "mlflow.server.playground_api._dispatch_feedback",
        side_effect=RuntimeError("LLM down"),
    ):
        response = client.post(_DISPATCH_PATH, json=_valid_dispatch_payload())

    assert response.status_code == 500
    assert "LLM down" in response.json()["detail"]
