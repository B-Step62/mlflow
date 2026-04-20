"""
Framework-agnostic response helpers for MLflow server handlers.

These helpers wrap Flask response construction today but provide a single
point of change when migrating to FastAPI. Handlers should use these
instead of constructing Flask Response objects directly.
"""

from __future__ import annotations

import json

from flask import Response

from mlflow.utils.proto_json_utils import message_to_json


def make_proto_response(proto_message) -> Response:
    """Create a JSON response from a protobuf message.

    This is the most common response pattern in handlers.py (~38 usages).
    """
    response = Response(mimetype="application/json")
    response.set_data(message_to_json(proto_message))
    return response


def make_json_response(data: dict) -> Response:
    """Create a JSON response from a dictionary.

    Uses ``json.dumps`` directly instead of Flask's ``jsonify`` because the
    latter requires a Flask app context (``current_app``), which is not set
    up when handlers are dispatched via FastAPI.
    """
    return Response(
        response=json.dumps(data),
        mimetype="application/json",
    )


def make_empty_response(status: int = 204) -> Response:
    """Create an empty response with the given status code."""
    return Response(status=status)


def make_error_text_response(message: str, status: int) -> Response:
    """Create a plain-text error response."""
    return Response(message, status)
