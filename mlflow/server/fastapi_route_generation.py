"""
FastAPI route generation from protobuf service descriptors.

Registers every Flask handler as a native FastAPI route. Handlers receive a
``RequestContext`` as their ``flask_request`` parameter (M0c made them accept
either a Flask ``Request`` or a ``RequestContext``), so no Flask request
context is created at runtime.
"""

from __future__ import annotations

import os
import re
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from mlflow.protos import databricks_pb2
from mlflow.server.handlers import STATIC_PREFIX_ENV_VAR, get_handler
from mlflow.server.request_context import from_fastapi_request


def _add_static_prefix(route: str) -> str:
    if prefix := os.environ.get(STATIC_PREFIX_ENV_VAR):
        return prefix.rstrip("/") + route
    return route


def _get_rest_path(base_path: str, version: int = 2) -> str:
    return f"/api/{version}.0{base_path}"


def _get_ajax_path(base_path: str, version: int = 2) -> str:
    return _add_static_prefix(f"/ajax-api/{version}.0{base_path}")


def _convert_path_parameter_for_fastapi(path: str) -> str:
    """Normalize Databricks ``{assessment.trace_id}`` to FastAPI-compatible ``{trace_id}``.

    FastAPI natively supports ``{param}`` so simple parameters need no conversion.
    """
    return re.sub(r"{assessment\.trace_id}", r"{trace_id}", path)


def _get_paths(base_path: str, version: int = 2) -> list[str]:
    base_path = _convert_path_parameter_for_fastapi(base_path)
    return [_get_rest_path(base_path, version), _get_ajax_path(base_path, version)]


def _make_fastapi_handler(flask_handler):
    """Adapt a Flask-style handler for FastAPI.

    We ALWAYS set up a Flask ``test_request_context`` that mirrors the incoming
    FastAPI request. This makes Flask globals (``flask.request``, ``current_app``,
    ``send_file``, ``jsonify``) available inside the handler -- necessary because
    handlers still call Flask-dependent helpers internally.

    Note: no ``@wraps(flask_handler)`` -- that would propagate the handler's
    signature to the wrapper and break FastAPI's dependency injection.
    """
    import inspect

    try:
        sig = inspect.signature(flask_handler)
        accepts_flask_request = "flask_request" in sig.parameters
    except (TypeError, ValueError):
        accepts_flask_request = False

    async def wrapper(request: Request):
        ctx = await from_fastapi_request(request)
        path_params = dict(request.path_params)
        from mlflow.server import app as _flask_app

        with _flask_app.test_request_context(
            path=request.url.path,
            method=request.method,
            query_string=request.url.query or "",
            content_type=request.headers.get("content-type"),
            data=ctx.data,
            headers=dict(request.headers),
        ):
            if accepts_flask_request:
                result = flask_handler(flask_request=ctx, **path_params)
            else:
                result = flask_handler(**path_params)
        return _convert_flask_response(result)

    wrapper.__name__ = flask_handler.__name__
    return wrapper


def _convert_flask_response(result) -> Response:
    """Convert a Flask ``Response`` (or dict/tuple) to a FastAPI ``Response``."""
    # Raw dict (e.g. gateway_proxy_handler returns dicts on success)
    if isinstance(result, (dict, list)):
        return JSONResponse(content=result)

    # Tuple of (body, status) -- Flask shorthand
    if isinstance(result, tuple):
        body, status = result
        if isinstance(body, (dict, list)):
            return JSONResponse(content=body, status_code=status)
        return Response(content=str(body), status_code=status)

    # Flask Response object (the common case)
    from flask import Response as FlaskResponse

    if isinstance(result, FlaskResponse):
        return Response(
            content=result.get_data(),
            status_code=result.status_code,
            media_type=result.content_type or "application/json",
            headers={k: v for k, v in result.headers.items() if k.lower() != "content-length"},
        )

    # Fallback
    return JSONResponse(content=str(result))


_METHOD_MAP = {
    "GET": "get",
    "POST": "post",
    "PUT": "put",
    "DELETE": "delete",
    "PATCH": "patch",
}


def get_fastapi_service_endpoints(service, get_handler_fn=get_handler):
    """Generate (path, wrapped_handler, methods) tuples for a protobuf service.

    Parity with handlers.get_service_endpoints() but with FastAPI-wrapped handlers
    and FastAPI-compatible path parameters.
    """
    ret = []
    for service_method in service.DESCRIPTOR.methods:
        endpoints = service_method.GetOptions().Extensions[databricks_pb2.rpc].endpoints
        for endpoint in endpoints:
            handler = get_handler_fn(service().GetRequestClass(service_method))
            wrapped = _make_fastapi_handler(handler)
            for http_path in _get_paths(endpoint.path, version=endpoint.since.major):
                ret.append((http_path, wrapped, [endpoint.method]))
    return ret


def _route_specificity_key(path: str) -> tuple:
    """Sort key that makes literal path segments beat ``{param}`` segments.

    FastAPI matches routes in registration order. Without this sort, a
    parameterized route like ``/traces/{trace_id}`` registered before a literal
    ``/traces/get`` will swallow requests to the literal path. We sort so that
    per segment, literal segments rank ahead of parameterized ones.
    """
    return tuple(1 if seg.startswith("{") else 0 for seg in path.split("/"))


def register_endpoints_on_router(router: APIRouter, endpoints):
    """Register (path, handler, methods) tuples on a FastAPI router.

    Routes are sorted so that literal path segments are registered before
    parameterized ones, preventing ``{param}`` routes from swallowing literal ones.
    """
    endpoints = sorted(endpoints, key=lambda e: _route_specificity_key(e[0]))
    for path, handler, methods in endpoints:
        for method in methods:
            register_fn = getattr(router, _METHOD_MAP.get(method, "get"))
            # response_model=None: prevents FastAPI from treating the Flask Response
            # return annotation as a Pydantic model to validate.
            register_fn(path, name=handler.__name__, response_model=None)(handler)


def create_protobuf_api_router() -> APIRouter:
    """Build a FastAPI router with all protobuf-generated + explicit endpoints."""
    from mlflow.protos.mlflow_artifacts_pb2 import MlflowArtifactsService
    from mlflow.protos.model_registry_pb2 import ModelRegistryService
    from mlflow.protos.service_pb2 import MlflowService
    from mlflow.protos.webhooks_pb2 import WebhookService
    from mlflow.server.handlers import (
        _get_server_info,
        _graphql,
        get_demo_endpoints,
        get_gateway_endpoints,
        get_internal_online_scoring_endpoints,
    )

    router = APIRouter()

    endpoints = get_fastapi_service_endpoints(MlflowService)
    endpoints += get_fastapi_service_endpoints(ModelRegistryService)
    endpoints += get_fastapi_service_endpoints(MlflowArtifactsService)
    endpoints += get_fastapi_service_endpoints(WebhookService)

    # Non-protobuf endpoints (wrap existing Flask handlers)
    for path, handler, methods in get_internal_online_scoring_endpoints():
        endpoints.append((path, _make_fastapi_handler(handler), methods))

    endpoints.append((
        _add_static_prefix("/graphql"),
        _make_fastapi_handler(_graphql),
        ["GET", "POST"],
    ))

    for _path in _get_paths("/mlflow/server-info", version=3):
        endpoints.append((_path, _make_fastapi_handler(_get_server_info), ["GET"]))

    for path, handler, methods in get_gateway_endpoints():
        endpoints.append((path, _make_fastapi_handler(handler), methods))

    for path, handler, methods in get_demo_endpoints():
        endpoints.append((path, _make_fastapi_handler(handler), methods))

    register_endpoints_on_router(router, endpoints)
    return router
