"""Integration tests for FastAPI security middleware.

Mirrors tests/server/test_security_integration.py (which tests the Flask
middleware) to verify parity when running under uvicorn.
"""

import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def fastapi_client():
    """FastAPI TestClient with the full MLflow app (security + all routers)."""
    from mlflow.server.fastapi_app import create_fastapi_app

    app = create_fastapi_app()
    # TestClient default Host header would be "testserver" which fails host
    # validation; set base_url so tests get a valid localhost Host.
    return TestClient(app, base_url="http://127.0.0.1:5000")


@pytest.mark.parametrize(
    ("host", "origin", "expected_status", "should_block"),
    [
        ("evil.attacker.com:5000", "http://evil.attacker.com:5000", 403, True),
        ("localhost:5000", None, None, False),
    ],
)
def test_fastapi_dns_rebinding_and_cors_protection(
    fastapi_client, host, origin, expected_status, should_block
):
    headers = {"Host": host, "Content-Type": "application/json"}
    if origin:
        headers["Origin"] = origin

    response = fastapi_client.post(
        "/api/2.0/mlflow/experiments/search",
        headers=headers,
        content=json.dumps({"max_results": 50}),
    )

    if should_block:
        assert response.status_code == expected_status
        body = response.content
        assert b"Invalid Host header" in body or b"Cross-origin request blocked" in body
    else:
        assert response.status_code != 403


@pytest.mark.parametrize(
    ("origin", "endpoint", "expected_blocked"),
    [
        ("http://malicious-site.com", "/api/2.0/mlflow/experiments/create", True),
        ("http://localhost:3000", "/api/2.0/mlflow/experiments/create", False),
    ],
)
def test_fastapi_cross_origin_state_changes_blocked(
    fastapi_client, origin, endpoint, expected_blocked
):
    headers = {
        "Host": "localhost:5000",
        "Origin": origin,
        "Content-Type": "application/json",
    }
    response = fastapi_client.post(endpoint, headers=headers, content=json.dumps({}))
    if expected_blocked:
        assert response.status_code == 403
        assert b"Cross-origin request blocked" in response.content
    else:
        assert response.status_code != 403


def test_fastapi_security_headers_present(fastapi_client):
    """Every response should have X-Content-Type-Options: nosniff."""
    response = fastapi_client.get("/health")
    assert response.status_code == 200
    assert response.headers.get("x-content-type-options") == "nosniff"


def test_fastapi_health_endpoint_skips_host_validation(fastapi_client):
    """/health should be reachable even with an invalid Host header."""
    response = fastapi_client.get("/health", headers={"Host": "evil.attacker.com"})
    assert response.status_code == 200
    assert response.text == "OK"
