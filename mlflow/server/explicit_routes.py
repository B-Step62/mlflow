"""
FastAPI router for explicit routes (health, version, artifacts, metrics, telemetry,
static files, React shell) that were previously @app.route decorators in __init__.py.
"""

from __future__ import annotations

import os
import textwrap

from fastapi import APIRouter
from fastapi.responses import FileResponse, PlainTextResponse

from mlflow.server.fastapi_route_generation import _add_static_prefix, _make_fastapi_handler
from mlflow.server.handlers import (
    _search_datasets_handler,
    create_promptlab_run_handler,
    gateway_proxy_handler,
    get_artifact_handler,
    get_logged_model_artifact_handler,
    get_metric_history_bulk_handler,
    get_metric_history_bulk_interval_handler,
    get_model_version_artifact_handler,
    get_trace_artifact_handler,
    get_ui_telemetry_handler,
    post_ui_telemetry_handler,
    upload_artifact_handler,
)
from mlflow.version import VERSION


def create_explicit_routes_router(static_folder: str) -> APIRouter:
    """Create a FastAPI router with all explicit (non-protobuf) routes.

    Args:
        static_folder: Absolute path to the React app build directory.
    """
    router = APIRouter()

    @router.get(_add_static_prefix("/health"))
    async def health():
        return PlainTextResponse("OK", status_code=200)

    @router.get(_add_static_prefix("/version"))
    async def version():
        return PlainTextResponse(VERSION, status_code=200)

    # Artifact serving
    router.get(_add_static_prefix("/get-artifact"), response_model=None)(
        _make_fastapi_handler(get_artifact_handler)
    )
    router.get(_add_static_prefix("/model-versions/get-artifact"), response_model=None)(
        _make_fastapi_handler(get_model_version_artifact_handler)
    )

    # Metrics bulk endpoints
    router.get(
        _add_static_prefix("/ajax-api/2.0/mlflow/metrics/get-history-bulk"),
        response_model=None,
    )(_make_fastapi_handler(get_metric_history_bulk_handler))
    router.get(
        _add_static_prefix("/ajax-api/2.0/mlflow/metrics/get-history-bulk-interval"),
        response_model=None,
    )(_make_fastapi_handler(get_metric_history_bulk_interval_handler))

    # Datasets
    router.post(
        _add_static_prefix("/ajax-api/2.0/mlflow/experiments/search-datasets"),
        response_model=None,
    )(_make_fastapi_handler(_search_datasets_handler))

    # Promptlab
    router.post(
        _add_static_prefix("/ajax-api/2.0/mlflow/runs/create-promptlab-run"),
        response_model=None,
    )(_make_fastapi_handler(create_promptlab_run_handler))

    # Gateway proxy (GET + POST)
    router.api_route(
        _add_static_prefix("/ajax-api/2.0/mlflow/gateway-proxy"),
        methods=["GET", "POST"],
        response_model=None,
    )(_make_fastapi_handler(gateway_proxy_handler))

    # Upload artifact
    router.post(
        _add_static_prefix("/ajax-api/2.0/mlflow/upload-artifact"),
        response_model=None,
    )(_make_fastapi_handler(upload_artifact_handler))

    # Trace artifact (v2 + v3)
    trace_handler = _make_fastapi_handler(get_trace_artifact_handler)
    router.get(
        _add_static_prefix("/ajax-api/2.0/mlflow/get-trace-artifact"),
        response_model=None,
    )(trace_handler)
    router.get(
        _add_static_prefix("/ajax-api/3.0/mlflow/get-trace-artifact"),
        response_model=None,
    )(trace_handler)

    # Logged model artifacts
    router.get(
        _add_static_prefix("/ajax-api/2.0/mlflow/logged-models/{model_id}/artifacts/files"),
        response_model=None,
    )(_make_fastapi_handler(get_logged_model_artifact_handler))

    # UI telemetry
    router.get(
        _add_static_prefix("/ajax-api/3.0/mlflow/ui-telemetry"),
        response_model=None,
    )(_make_fastapi_handler(get_ui_telemetry_handler))
    router.post(
        _add_static_prefix("/ajax-api/3.0/mlflow/ui-telemetry"),
        response_model=None,
    )(_make_fastapi_handler(post_ui_telemetry_handler))

    # Static React assets
    @router.get(_add_static_prefix("/static-files/{path:path}"))
    async def serve_static_file(path: str):
        file_path = os.path.join(static_folder, path)
        if os.path.isfile(file_path):
            return FileResponse(file_path, headers={"Cache-Control": "public, max-age=2419200"})
        return PlainTextResponse("Not found", status_code=404)

    # React app shell
    @router.get(_add_static_prefix("/"), response_model=None)
    async def serve():
        index_path = os.path.join(static_folder, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        text = textwrap.dedent("""\
            Unable to display MLflow UI - landing page (index.html) not found.
            You are likely running from a source installation. Build the UI with
            `yarn build` inside mlflow/server/js/ or install an official mlflow release.
        """)
        return PlainTextResponse(text)

    return router
