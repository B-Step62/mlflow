# Runtime fail-closed enforcement for FastAPI routes without validators.

from fastapi import FastAPI
from starlette.responses import PlainTextResponse
from starlette.testclient import TestClient

from mlflow.server import auth as a
from mlflow.server.request_context import Authorization


async def _mounted_asgi_app(scope, receive, send):
    await PlainTextResponse("mounted-ok")(scope, receive, send)


def _build_client(monkeypatch):
    # No route resolves a validator, and nothing is "unprotected", so the fail-closed
    # branch is what decides native routes.
    monkeypatch.setattr(a, "is_unprotected_route", lambda path: False)
    monkeypatch.setattr(a, "_find_fastapi_validator", lambda path, method: None)
    monkeypatch.setattr(a, "authenticate_request", lambda: Authorization(username="u"))
    monkeypatch.setattr(a, "sender_is_admin", lambda: False)

    app = FastAPI()

    @app.get("/api/3.0/mlflow/native-new-feature")
    async def native():
        return PlainTextResponse("native-ok")

    app.mount("/mounted", _mounted_asgi_app)
    a.add_fastapi_permission_middleware(app)
    return TestClient(app)


def test_native_route_without_validator_denied_when_fail_closed(monkeypatch):
    monkeypatch.setenv("MLFLOW_BASIC_AUTH_FAIL_CLOSED", "true")
    client = _build_client(monkeypatch)
    assert client.get("/api/3.0/mlflow/native-new-feature").status_code == 403


def test_native_route_allowed_when_flag_off(monkeypatch):
    monkeypatch.setenv("MLFLOW_BASIC_AUTH_FAIL_CLOSED", "false")
    client = _build_client(monkeypatch)
    resp = client.get("/api/3.0/mlflow/native-new-feature")
    assert resp.status_code == 200
    assert resp.text == "native-ok"


def test_mounted_asgi_path_is_denied_when_fail_closed(monkeypatch):
    monkeypatch.setenv("MLFLOW_BASIC_AUTH_FAIL_CLOSED", "true")
    client = _build_client(monkeypatch)
    assert client.get("/mounted/anything").status_code == 403


def test_documented_marker_exempts_native_route(monkeypatch):
    monkeypatch.setenv("MLFLOW_BASIC_AUTH_FAIL_CLOSED", "true")
    monkeypatch.setattr(a, "_KNOWN_UNGATED_ROUTE_MARKERS", ("/mlflow/native-new-feature",))
    client = _build_client(monkeypatch)
    assert client.get("/api/3.0/mlflow/native-new-feature").status_code == 200
