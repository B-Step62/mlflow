"""
Framework-agnostic request context for MLflow server handlers.

This module provides a RequestContext dataclass that decouples handler business logic
from Flask's request object, enabling incremental migration to FastAPI.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import IO, Any


@dataclass(frozen=True)
class RequestContext:
    """Framework-agnostic representation of an HTTP request.

    Captures the subset of HTTP request data that MLflow handlers actually use,
    without depending on Flask or FastAPI request objects.
    """

    method: str
    """HTTP method (GET, POST, PUT, DELETE, PATCH)."""

    args: dict[str, str | list[str]]
    """Query parameters. Single values are strings; repeated params are lists."""

    json_body: dict[str, Any] | str | None
    """Parsed JSON body, or None if no body / not JSON."""

    headers: dict[str, str]
    """HTTP headers (case-insensitive lookup should be handled by caller)."""

    content_type: str | None
    """Content-Type header value, e.g. 'application/json; charset=utf-8'."""

    path: str = ""
    """Request URL path."""

    stream: IO[bytes] | None = field(default=None, repr=False)
    """Raw request body stream for chunked/binary uploads."""

    content_length: int | None = None
    """Content-Length header as integer, if present."""

    def args_get(self, key: str, default: str | None = None) -> str | None:
        """Get a single query parameter value (first value if repeated)."""
        value = self.args.get(key, default)
        if isinstance(value, list):
            return value[0] if value else default
        return value

    def args_getlist(self, key: str) -> list[str]:
        """Get all values for a repeated query parameter."""
        value = self.args.get(key, [])
        if isinstance(value, list):
            return value
        return [value]

    def get_json(self) -> dict[str, Any] | str | None:
        """Return the parsed JSON body."""
        return self.json_body


def from_flask_request(flask_request) -> RequestContext:
    """Create a RequestContext from a Flask/Werkzeug request object.

    Args:
        flask_request: A Flask ``Request`` object (``flask.request``).
    """
    # Collect query params preserving repeated values
    args: dict[str, str | list[str]] = {}
    for key in flask_request.args:
        values = flask_request.args.getlist(key)
        args[key] = values if len(values) > 1 else values[0]

    # Parse JSON body (same behavior as flask_request.get_json(force=True, silent=True))
    json_body = flask_request.get_json(force=True, silent=True)

    headers = dict(flask_request.headers)

    return RequestContext(
        method=flask_request.method,
        args=args,
        json_body=json_body,
        headers=headers,
        content_type=flask_request.content_type,
        path=flask_request.path,
        stream=flask_request.stream,
        content_length=flask_request.content_length,
    )


async def from_fastapi_request(fastapi_request) -> RequestContext:
    """Create a RequestContext from a FastAPI/Starlette request object.

    Args:
        fastapi_request: A Starlette ``Request`` object.
    """
    # Collect query params preserving repeated values
    args: dict[str, str | list[str]] = {}
    for key in fastapi_request.query_params:
        values = fastapi_request.query_params.getlist(key)
        args[key] = values if len(values) > 1 else values[0]

    # Parse JSON body
    json_body = None
    content_type = fastapi_request.headers.get("content-type", "")
    if "application/json" in content_type or fastapi_request.method in ("POST", "PUT", "PATCH"):
        try:
            body_bytes = await fastapi_request.body()
            if body_bytes:
                json_body = json.loads(body_bytes)
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass

    headers = dict(fastapi_request.headers)

    return RequestContext(
        method=fastapi_request.method,
        args=args,
        json_body=json_body,
        headers=headers,
        content_type=content_type or None,
        path=fastapi_request.url.path,
        stream=None,  # FastAPI stream access is async; handled separately
        content_length=int(fastapi_request.headers.get("content-length", 0)) or None,
    )
