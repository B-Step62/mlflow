"""
FastAPI application for MLflow server.

All handler endpoints are registered as native FastAPI routes. A request-shim
middleware populates a ``contextvars.ContextVar`` so that sync handler code can
read the current HTTP request without importing Flask.
"""

import inspect
import json
import os
import re
import textwrap
import time

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from starlette.responses import Response
from starlette.staticfiles import StaticFiles

from mlflow.exceptions import MlflowException
from mlflow.gateway.constants import MLFLOW_GATEWAY_DURATION_HEADER, MLFLOW_GATEWAY_OVERHEAD_HEADER
from mlflow.gateway.providers.utils import provider_call_duration_ms
from mlflow.server.artifact_router import artifact_router
from mlflow.server.asgi_utils import get_routed_asgi_path
from mlflow.server.assistant.api import assistant_router
from mlflow.server.fastapi_security import init_fastapi_security
from mlflow.server.gateway_api import gateway_router
from mlflow.server.job_api import job_api_router
from mlflow.server.mcp_server_api import (
    _mlflow_error_response,
    _request_validation_error_response,
    get_mcp_server_api_route_prefixes,
    is_mcp_server_api_path,
    mcp_server_router,
)
from mlflow.server.otel_api import otel_router
from mlflow.server.request_context import (
    clear_g,
    clear_request,
    from_starlette_request,
    set_request,
)
from mlflow.server.workspace_helpers import (
    WORKSPACE_HEADER_NAME,
    resolve_workspace_for_request_if_enabled,
)
from mlflow.utils.workspace_context import (
    clear_server_request_workspace,
    set_server_request_workspace,
)
from mlflow.version import VERSION

_FLASK_PATH_PARAM = re.compile(r"<(?:(int|float|path|string|uuid):)?([^>]+)>")

REL_STATIC_DIR = os.path.join(os.path.dirname(__file__), "js", "build")


def _flask_to_fastapi_path(flask_path: str) -> str:
    """Convert Flask-style ``<param>`` and ``<path:param>`` to FastAPI ``{param}``."""

    def _replace(m: re.Match) -> str:
        converter, name = m.group(1), m.group(2)
        if converter == "path":
            return f"{{{name}:path}}"
        return f"{{{name}}}"

    return _FLASK_PATH_PARAM.sub(_replace, flask_path)


def add_fastapi_workspace_middleware(fastapi_app: FastAPI) -> None:
    if getattr(fastapi_app.state, "workspace_middleware_added", False):
        return

    @fastapi_app.middleware("http")
    async def workspace_context_middleware(request: Request, call_next):
        try:
            workspace = resolve_workspace_for_request_if_enabled(
                get_routed_asgi_path(request),
                request.headers.get(WORKSPACE_HEADER_NAME),
            )
        except MlflowException as e:
            return JSONResponse(
                status_code=e.get_http_status_code(),
                content=json.loads(e.serialize_as_json()),
            )

        set_server_request_workspace(workspace.name if workspace else None)
        try:
            response = await call_next(request)
        finally:
            clear_server_request_workspace()
        return response

    fastapi_app.state.workspace_middleware_added = True


def add_gateway_timing_middleware(fastapi_app: FastAPI) -> None:
    if getattr(fastapi_app.state, "gateway_timing_middleware_added", False):
        return

    @fastapi_app.middleware("http")
    async def gateway_timing_middleware(request: Request, call_next):
        if not get_routed_asgi_path(request).startswith("/gateway/"):
            return await call_next(request)

        provider_call_duration_ms.set(0.0)
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = int((time.perf_counter() - start) * 1000)
        provider_duration_ms = int(getattr(request.state, "gateway_provider_duration_ms", 0))

        response.headers[MLFLOW_GATEWAY_DURATION_HEADER] = str(duration_ms)
        if provider_duration_ms > 0:
            response.headers[MLFLOW_GATEWAY_OVERHEAD_HEADER] = str(
                max(0, duration_ms - provider_duration_ms)
            )
        return response

    fastapi_app.state.gateway_timing_middleware_added = True


def add_mcp_exception_handlers(fastapi_app: FastAPI) -> None:
    if getattr(fastapi_app.state, "mcp_exception_handlers_added", False):
        return

    original_mlflow_exception_handler = fastapi_app.exception_handlers.get(MlflowException)

    # These handlers are registered on the shared FastAPI app, so keep them
    # scoped to MCP routes to avoid changing response behavior for other APIs.
    @fastapi_app.exception_handler(MlflowException)
    async def mcp_mlflow_exception_handler(request: Request, exc: MlflowException):
        path = get_routed_asgi_path(request)
        if is_mcp_server_api_path(path):
            return _mlflow_error_response(exc)
        if original_mlflow_exception_handler is not None:
            response = original_mlflow_exception_handler(request, exc)
            if inspect.isawaitable(response):
                return await response
            return response
        return _mlflow_error_response(exc)

    @fastapi_app.exception_handler(RequestValidationError)
    async def mcp_request_validation_error_handler(request: Request, exc: RequestValidationError):
        path = get_routed_asgi_path(request)
        if is_mcp_server_api_path(path):
            return _request_validation_error_response(exc)
        return JSONResponse(status_code=422, content={"detail": exc.errors()})

    fastapi_app.state.mcp_exception_handlers_added = True


def add_request_shim_middleware(fastapi_app: FastAPI) -> None:
    if getattr(fastapi_app.state, "request_shim_middleware_added", False):
        return

    @fastapi_app.middleware("http")
    async def request_shim_middleware(request: Request, call_next):
        shim = await from_starlette_request(request)
        set_request(shim)
        try:
            response = await call_next(request)
        finally:
            clear_request()
            clear_g()
        return response

    fastapi_app.state.request_shim_middleware_added = True


def _register_handler_endpoints(fastapi_app: FastAPI) -> None:
    """Register all handler endpoints from ``handlers.get_endpoints()`` on FastAPI."""
    from mlflow.server import handlers
    from mlflow.server.handlers import STATIC_PREFIX_ENV_VAR

    static_prefix = os.environ.get(STATIC_PREFIX_ENV_VAR, "")

    for http_path, handler, methods in handlers.get_endpoints():
        fastapi_path = _flask_to_fastapi_path(http_path)
        fastapi_app.add_api_route(
            fastapi_path,
            handler,
            methods=methods,
            response_class=Response,
        )

    # Additional routes previously defined on the Flask app in __init__.py
    @fastapi_app.get(static_prefix + "/health")
    def health():
        return PlainTextResponse("OK")

    @fastapi_app.get(static_prefix + "/version")
    def version():
        return PlainTextResponse(VERSION)

    @fastapi_app.get(static_prefix + "/get-artifact")
    def serve_artifacts():
        return handlers.get_artifact_handler()

    @fastapi_app.get(static_prefix + "/model-versions/get-artifact")
    def serve_model_version_artifact():
        return handlers.get_model_version_artifact_handler()

    @fastapi_app.get(static_prefix + "/ajax-api/2.0/mlflow/metrics/get-history-bulk")
    def serve_get_metric_history_bulk():
        return handlers.get_metric_history_bulk_handler()

    @fastapi_app.get(static_prefix + "/ajax-api/2.0/mlflow/metrics/get-history-bulk-interval")
    def serve_get_metric_history_bulk_interval():
        return handlers.get_metric_history_bulk_interval_handler()

    @fastapi_app.post(static_prefix + "/ajax-api/2.0/mlflow/experiments/search-datasets")
    def serve_search_datasets():
        return handlers._search_datasets_handler()

    @fastapi_app.post(static_prefix + "/ajax-api/2.0/mlflow/runs/create-promptlab-run")
    def serve_create_promptlab_run():
        return handlers.create_promptlab_run_handler()

    @fastapi_app.api_route(
        static_prefix + "/ajax-api/2.0/mlflow/gateway-proxy",
        methods=["POST", "GET"],
    )
    def serve_gateway_proxy():
        return handlers.gateway_proxy_handler()

    @fastapi_app.post(static_prefix + "/ajax-api/2.0/mlflow/upload-artifact")
    def serve_upload_artifact():
        return handlers.upload_artifact_handler()

    @fastapi_app.get(static_prefix + "/ajax-api/2.0/mlflow/get-trace-artifact")
    @fastapi_app.get(static_prefix + "/ajax-api/3.0/mlflow/get-trace-artifact")
    def serve_get_trace_artifact():
        return handlers.get_trace_artifact_handler()

    @fastapi_app.get(
        static_prefix + "/ajax-api/2.0/mlflow/logged-models/{model_id}/artifacts/files"
    )
    def serve_get_logged_model_artifact(model_id: str):
        return handlers.get_logged_model_artifact_handler(model_id)

    @fastapi_app.get(static_prefix + "/ajax-api/3.0/mlflow/ui-telemetry")
    def serve_get_ui_telemetry():
        return handlers.get_ui_telemetry_handler()

    @fastapi_app.post(static_prefix + "/ajax-api/3.0/mlflow/ui-telemetry")
    def serve_post_ui_telemetry():
        return handlers.post_ui_telemetry_handler()

    # Serve the index.html for the React App for all unmatched routes.
    @fastapi_app.get(static_prefix + "/")
    def serve():
        index = os.path.join(REL_STATIC_DIR, "index.html")
        if os.path.exists(index):
            return FileResponse(index)

        text = textwrap.dedent(
            """
        Unable to display MLflow UI - landing page (index.html) not found.

        You are very likely running the MLflow server using a source installation
        of the Python MLflow package.

        If you are a developer making MLflow source code changes and intentionally running a source
        installation of MLflow, you can view the UI by running the Javascript dev server:
        https://github.com/mlflow/mlflow/blob/master/CONTRIBUTING.md#running-the-javascript-dev-server

        Otherwise, uninstall MLflow via 'pip uninstall mlflow', reinstall an official MLflow release
        from PyPI via 'pip install mlflow', and rerun the MLflow server.
        """
        )
        return PlainTextResponse(text)


def _mount_static_files(fastapi_app: FastAPI) -> None:
    """Mount the React build static files directory."""
    from mlflow.server.handlers import STATIC_PREFIX_ENV_VAR

    static_prefix = os.environ.get(STATIC_PREFIX_ENV_VAR, "")

    if os.path.isdir(REL_STATIC_DIR):
        fastapi_app.mount(
            static_prefix + "/static-files",
            StaticFiles(directory=REL_STATIC_DIR),
            name="static-files",
        )


def create_fastapi_app():
    """Create a FastAPI application with all MLflow endpoints registered natively."""
    fastapi_app = FastAPI(
        title="MLflow Tracking Server",
        description="MLflow Tracking Server API",
        version=VERSION,
        # Docs/OpenAPI remain disabled intentionally even though several native
        # FastAPI routers are mounted (otel, jobs, gateway, assistant, artifacts).
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    # Initialize security middleware BEFORE adding routes
    init_fastapi_security(fastapi_app)

    # Middleware registration order matters: last registered runs first.
    # We want: workspace -> gateway timing -> request shim -> handler
    add_fastapi_workspace_middleware(fastapi_app)
    add_gateway_timing_middleware(fastapi_app)
    add_request_shim_middleware(fastapi_app)

    # Include existing native FastAPI routers
    fastapi_app.include_router(otel_router)
    fastapi_app.include_router(job_api_router)
    fastapi_app.include_router(gateway_router)
    fastapi_app.include_router(assistant_router)

    # Include native artifact upload/download router for ASGI streaming
    # This provides /api/2.0/mlflow-artifacts/artifacts/* and /ajax-api/2.0/... routes
    fastapi_app.include_router(artifact_router)

    add_mcp_exception_handlers(fastapi_app)
    for route_prefix in get_mcp_server_api_route_prefixes():
        fastapi_app.include_router(mcp_server_router, prefix=route_prefix)

    # Register all handler endpoints as native FastAPI routes
    _register_handler_endpoints(fastapi_app)

    # Mount static files for the React frontend
    _mount_static_files(fastapi_app)

    return fastapi_app


# Create the app instance that can be used by ASGI servers
app = create_fastapi_app()
