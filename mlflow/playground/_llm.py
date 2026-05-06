"""Shared LLM call helper for the playground.

Test-case generation and judge evaluation both call a Databricks model-
serving endpoint using its OpenAI-compatible API surface. Centralized here
so the credential handling, endpoint resolution, and OpenAI client wiring
live in one place — no managed-judge adapter, no `databricks-agents`
dependency, no raw provider API keys.

Endpoint resolution:

  * ``DATABRICKS_HOST`` (env, required) — workspace URL, e.g.
    ``https://dbc-foo.cloud.databricks.com``.
  * ``DATABRICKS_TOKEN`` (env, required) — personal access token.
  * ``MLFLOW_PLAYGROUND_DATABRICKS_ENDPOINT`` (env, optional) — endpoint
    name. Defaults to ``databricks-gpt-5-4``.

Structured output (``response_format``) is forwarded as-is when supplied;
``pydantic_to_response_format()`` converts a Pydantic model class to the
OpenAI ``json_schema`` dict the endpoint expects.
"""

from __future__ import annotations

import os
from typing import Any

import pydantic

_DEFAULT_DATABRICKS_ENDPOINT = "databricks-gpt-5-4"
_DATABRICKS_ENDPOINT_ENV = "MLFLOW_PLAYGROUND_DATABRICKS_ENDPOINT"


def pydantic_to_response_format(model: type[pydantic.BaseModel]) -> dict[str, Any]:
    """Build the OpenAI ``response_format`` dict for a Pydantic model class.

    Wraps ``model.model_json_schema()`` in the ``{"type": "json_schema",
    "json_schema": {"name", "schema"}}`` shape OpenAI / OpenAI-compatible
    endpoints accept. The returned dict is safe to pass straight through to
    ``client.chat.completions.create(..., response_format=<dict>)``.
    """
    return {
        "type": "json_schema",
        "json_schema": {
            "name": model.__name__.lstrip("_"),
            "schema": model.model_json_schema(),
        },
    }


def call_databricks_endpoint(
    prompt: str,
    *,
    response_format: dict[str, Any] | None = None,
) -> str:
    """Send a single user-message prompt to the configured Databricks endpoint.

    Returns the assistant's text content (empty string if the endpoint
    returns no content). Raises ``RuntimeError`` if either credential is
    missing — surfaces a clear setup hint instead of a confusing 401 from
    the endpoint.
    """
    host = os.environ.get("DATABRICKS_HOST", "").rstrip("/")
    token = os.environ.get("DATABRICKS_TOKEN", "")
    if not host or not token:
        raise RuntimeError(
            "Playground LLM access needs Databricks workspace credentials. "
            "Set DATABRICKS_HOST (workspace URL) and DATABRICKS_TOKEN (PAT) "
            "in the environment running `mlflow agent playground`, then retry."
        )
    endpoint = os.environ.get(_DATABRICKS_ENDPOINT_ENV, _DEFAULT_DATABRICKS_ENDPOINT)

    from openai import OpenAI

    client = OpenAI(api_key=token, base_url=f"{host}/serving-endpoints")
    kwargs: dict[str, Any] = {
        "model": endpoint,
        "messages": [{"role": "user", "content": prompt}],
    }
    if response_format is not None:
        kwargs["response_format"] = response_format
    response = client.chat.completions.create(**kwargs)
    return response.choices[0].message.content or ""


__all__ = [
    "call_databricks_endpoint",
    "pydantic_to_response_format",
]
