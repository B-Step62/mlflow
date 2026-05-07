"""Shared LLM call helper for the playground.

Test-case generation and judge evaluation issue single-turn structured-output
calls. The dispatcher in :func:`call_default_llm` always routes to the
Claude Code CLI (:mod:`mlflow.playground._claude_llm`); the Databricks
model-serving fallback below (:func:`call_databricks_endpoint`) is kept as
dead code so it can be re-enabled later, but no production caller reaches
it today.

Why the single-provider lock-in: we want every playground install to
exercise the Claude Code path so we don't ship a regression there
unnoticed. Flipping the dispatcher back to a multi-provider scheme is
intentionally a one-line change in :func:`call_default_llm`.
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

    Currently dead code: :func:`call_default_llm` no longer dispatches here.
    Kept around so re-enabling the Databricks path is a one-line change.
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


def call_default_llm(
    prompt: str,
    *,
    response_schema: type[pydantic.BaseModel],
) -> str:
    """Send ``prompt`` to the Claude Code CLI provider.

    The returned string is a JSON document parseable against
    ``response_schema`` — the CLI's ``--json-schema`` flag enforces the
    contract — so callers can safely call
    ``response_schema.model_validate_json(...)`` on the result.

    The Databricks fallback (:func:`call_databricks_endpoint`) is preserved
    in this module but not reached. To re-enable provider selection, fork
    this function on an env var or feature flag.
    """
    from mlflow.playground._claude_llm import call_claude

    return call_claude(prompt, response_schema=response_schema)


__all__ = [
    "call_databricks_endpoint",
    "call_default_llm",
    "pydantic_to_response_format",
]
