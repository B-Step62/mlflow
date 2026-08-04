import inspect
import json
import re
import uuid
from collections import defaultdict
from http import HTTPStatus

import pytest
from starlette.testclient import TestClient

from mlflow.environment_variables import MLFLOW_MODEL_CATALOG_URI
from mlflow.server import handlers
from mlflow.server.fastapi_app import _flask_to_fastapi_path, create_fastapi_app
from mlflow.server.handlers import get_endpoints, initialize_backend_stores

from tests.server.conftest import mock_request_context

_PATH_PARAM_RE = re.compile(r"<(?:(path):)?([^>]+)>")

_PARAM_VALUES = {
    "request_id": "tr-test",
    "trace_id": "tr-test",
    "workspace_name": "default",
    "model_id": "m-test",
    "tag_key": "tag",
    "key": "tag",
    "assessment_id": "a-test",
    "issue_id": "i-test",
    "dataset_id": "d-test",
    "job_id": "j-test",
    "webhook_id": "w-test",
    "artifact_path": "0/traces/tr-test/artifacts/file.txt",
}

_DIRECT_PARITY_SKIP_PATHS = {
    # GraphQL reads a parsed request object directly and does not have a useful
    # no-entity synthetic request path through the shim.
    "/graphql",
    # FastAPI keeps this legacy Flask route as an explicit additional route in
    # front of the generated endpoint metadata.
    "/ajax-api/2.0/mlflow/experiments/search-datasets",
    # Artifact download/upload routes are served by the native FastAPI artifact router,
    # whose error response envelope intentionally differs from the legacy direct handler.
    "/api/2.0/mlflow-artifacts/artifacts/<path:artifact_path>",
    "/ajax-api/2.0/mlflow-artifacts/artifacts/<path:artifact_path>",
}


@pytest.fixture
def parity_client(tmp_path, monkeypatch):
    monkeypatch.setenv(MLFLOW_MODEL_CATALOG_URI.name, "")
    backend_uri = f"sqlite:///{tmp_path / 'mlflow.db'}"
    artifact_root = (tmp_path / "artifacts").as_uri()
    handlers._tracking_store = None
    handlers._model_registry_store = None
    handlers._job_store = None
    initialize_backend_stores(backend_uri, default_artifact_root=artifact_root)
    yield TestClient(create_fastapi_app(), raise_server_exceptions=False)
    handlers._tracking_store = None
    handlers._model_registry_store = None
    handlers._job_store = None


def _materialize_path(flask_path):
    view_args = {}

    def replace(match):
        param_name = match.group(2)
        value = _PARAM_VALUES.get(param_name, f"{param_name}-test")
        view_args[param_name] = value
        return value

    return _PATH_PARAM_RE.sub(replace, flask_path), view_args


def _synthetic_body(path, method):
    if path.endswith("/mlflow/demo/generate"):
        return b'{"features":[]}', "application/json"
    if method in {"POST", "PATCH", "PUT"}:
        return b"{}", "text/plain"
    return b"", None


def _request(client, method, path, body=b"", content_type=None):
    kwargs = {"headers": {"Host": "localhost"}}
    if content_type:
        kwargs["headers"]["Content-Type"] = content_type
    if body:
        kwargs["content"] = body
    return getattr(client, method.lower())(path, **kwargs)


def _call_direct(handler, method, path, view_args, body, content_type):
    with mock_request_context(
        path=path,
        method=method,
        data=body,
        content_type=content_type,
        view_args=view_args,
    ) as request:
        request.url_rule = path
        signature = inspect.signature(handler)
        kwargs = {k: v for k, v in view_args.items() if k in signature.parameters}
        return handler(**kwargs)


def _normalized_body(body):
    if not body:
        return None
    try:
        return json.loads(body)
    except (TypeError, ValueError):
        return body.decode("utf-8", errors="replace") if isinstance(body, bytes) else body


def _content_type(headers, response=None):
    content_type = headers.get("content-type") if headers else None
    if content_type is None and response is not None:
        content_type = getattr(response, "content_type", None) or getattr(
            response, "mimetype", None
        )
    return content_type.split(";", 1)[0] if content_type else None


def _normalize_response(response):
    if response is None:
        return HTTPStatus.OK, None, None

    status_code = getattr(response, "status_code", HTTPStatus.OK)
    if hasattr(response, "get_data"):
        body = response.get_data()
    elif hasattr(response, "content"):
        body = response.content
    elif hasattr(response, "body"):
        body = response.body
    elif isinstance(response, bytes):
        body = response
    elif isinstance(response, str):
        body = response.encode()
    else:
        body = json.dumps(response, sort_keys=True).encode()

    return (
        int(status_code),
        _normalized_body(body),
        _content_type(getattr(response, "headers", {}), response),
    )


def _is_starlette_route_not_found(response):
    if response.status_code != HTTPStatus.NOT_FOUND:
        return False
    try:
        return response.json() == {"detail": "Not Found"}
    except ValueError:
        return response.text == "Not Found"


def test_all_generated_endpoints_are_registered_on_fastapi():
    app = create_fastapi_app()
    route_methods = defaultdict(set)
    for route in app.routes:
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None)
        if path and methods:
            route_methods[path].update(methods - {"HEAD"})

    missing = []
    for flask_path, _, methods in get_endpoints():
        fastapi_path = _flask_to_fastapi_path(flask_path)
        missing.extend(
            (method, fastapi_path)
            for method in methods
            if method not in route_methods[fastapi_path]
        )

    assert not missing


def test_all_generated_endpoints_are_exercised_by_fastapi_router(parity_client):
    route_failures = []
    method_failures = []

    for flask_path, _, methods in get_endpoints():
        path, _ = _materialize_path(flask_path)
        method = methods[0]
        body, content_type = _synthetic_body(path, method)
        response = _request(parity_client, method, path, body=body, content_type=content_type)
        if _is_starlette_route_not_found(response):
            route_failures.append((method, path))

    for flask_path in {path for path, _, _ in get_endpoints()}:
        path, _ = _materialize_path(flask_path)
        response = _request(parity_client, "OPTIONS", path)
        if response.status_code != HTTPStatus.METHOD_NOT_ALLOWED:
            method_failures.append((path, response.status_code, response.text))

    assert not route_failures
    assert not method_failures


def test_generated_endpoint_synthetic_requests_match_direct_handlers(parity_client):
    diffs = []

    for flask_path, handler, methods in get_endpoints():
        if flask_path in _DIRECT_PARITY_SKIP_PATHS:
            continue

        method = methods[0]
        path, view_args = _materialize_path(flask_path)
        body, content_type = _synthetic_body(path, method)

        direct = _normalize_response(
            _call_direct(handler, method, path, view_args, body, content_type)
        )
        fastapi = _normalize_response(
            _request(parity_client, method, path, body=body, content_type=content_type)
        )
        if direct != fastapi:
            diffs.append((method, flask_path, direct, fastapi))

    assert not diffs


def test_static_generated_routes_precede_parameterized_routes(parity_client):
    routes = [
        route.path
        for route in parity_client.app.routes
        if hasattr(route, "path") and getattr(route, "methods", None)
    ]

    assert routes.index("/api/3.0/mlflow/traces/batchGet") < routes.index(
        "/api/3.0/mlflow/traces/{trace_id}"
    )
    assert routes.index("/ajax-api/3.0/mlflow/traces/batchGet") < routes.index(
        "/ajax-api/3.0/mlflow/traces/{trace_id}"
    )

    response = parity_client.get(
        "/api/3.0/mlflow/traces/batchGet",
        params={"trace_ids": ["tr-test"]},
        headers={"Host": "localhost"},
    )
    assert response.status_code != HTTPStatus.NOT_FOUND
    assert "batchGet" not in response.text


def test_repeated_slashes_are_normalized_before_routing(parity_client):
    response = parity_client.get(
        "//model-versions/get-artifact",
        params={"name": "model", "version": 1, "path": "../path"},
        headers={"Host": "localhost"},
    )

    assert response.status_code == HTTPStatus.BAD_REQUEST
    body = response.json()
    assert body["error_code"] == "INVALID_PARAMETER_VALUE"
    assert body["message"] == "Invalid path"


def test_golden_tracking_flow_response_contract(parity_client):
    suffix = uuid.uuid4().hex

    create_experiment = parity_client.post(
        "/api/2.0/mlflow/experiments/create",
        json={"name": f"parity-{suffix}"},
        headers={"Host": "localhost"},
    )
    assert create_experiment.status_code == HTTPStatus.OK
    experiment_id = create_experiment.json()["experiment_id"]

    create_run = parity_client.post(
        "/api/2.0/mlflow/runs/create",
        json={"experiment_id": experiment_id, "tags": [{"key": "source", "value": "parity"}]},
        headers={"Host": "localhost"},
    )
    assert create_run.status_code == HTTPStatus.OK
    run = create_run.json()["run"]
    run_id = run["info"]["run_id"]
    assert run["info"]["experiment_id"] == experiment_id
    assert {"key": "source", "value": "parity"} in run["data"]["tags"]

    log_param = parity_client.post(
        "/api/2.0/mlflow/runs/log-parameter",
        json={"run_id": run_id, "key": "compat_param", "value": "value"},
        headers={"Host": "localhost"},
    )
    assert log_param.status_code == HTTPStatus.OK
    assert log_param.json() == {}

    log_metric = parity_client.post(
        "/api/2.0/mlflow/runs/log-metric",
        json={"run_id": run_id, "key": "compat_metric", "value": 1.25, "timestamp": 1, "step": 3},
        headers={"Host": "localhost"},
    )
    assert log_metric.status_code == HTTPStatus.OK
    assert log_metric.json() == {}

    get_run = parity_client.get(
        "/api/2.0/mlflow/runs/get",
        params={"run_id": run_id},
        headers={"Host": "localhost"},
    )
    assert get_run.status_code == HTTPStatus.OK
    fetched_run = get_run.json()["run"]
    assert fetched_run["info"]["run_id"] == run_id
    assert fetched_run["data"]["params"] == [{"key": "compat_param", "value": "value"}]
    assert {"key": "compat_metric", "value": 1.25, "timestamp": 1, "step": 3} in fetched_run[
        "data"
    ]["metrics"]

    search_runs = parity_client.post(
        "/api/2.0/mlflow/runs/search",
        json={
            "experiment_ids": [experiment_id],
            "filter": "params.compat_param = 'value'",
            "order_by": ["metrics.compat_metric DESC"],
        },
        headers={"Host": "localhost"},
    )
    assert search_runs.status_code == HTTPStatus.OK
    assert [r["info"]["run_id"] for r in search_runs.json()["runs"]] == [run_id]
