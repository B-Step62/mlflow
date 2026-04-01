from __future__ import annotations

from mlflow.exceptions import MlflowException
from mlflow.protos.databricks_pb2 import INVALID_PARAMETER_VALUE


def _validate_content_type(request_or_ctx, allowed_content_types: list[str]):
    """
    Validates that the request content type is one of the allowed content types.

    Args:
        request_or_ctx: A Flask request object or a ``RequestContext`` instance.
            Both expose ``.method`` and ``.content_type``.
        allowed_content_types: A list of allowed content types.
    """
    if request_or_ctx.method not in ["POST", "PUT"]:
        return

    if request_or_ctx.content_type is None:
        raise MlflowException(
            message="Bad Request. Content-Type header is missing.",
            error_code=INVALID_PARAMETER_VALUE,
        )

    # Remove any parameters e.g. "application/json; charset=utf-8" -> "application/json"
    content_type = request_or_ctx.content_type.split(";")[0]
    if content_type not in allowed_content_types:
        message = f"Bad Request. Content-Type must be one of {allowed_content_types}."

        raise MlflowException(
            message=message,
            error_code=INVALID_PARAMETER_VALUE,
        )
