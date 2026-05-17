"""Playground entrypoint for the MLflow Assistant.

Adapts the streaming, multi-provider assistant into a single unary function
that the agent playground can invoke with a plain request dict.
"""

import os
from pathlib import Path
from typing import Any

import mlflow
from mlflow.assistant.config import AssistantConfig
from mlflow.assistant.providers import list_providers
from mlflow.assistant.providers.base import AssistantProvider
from mlflow.assistant.types import EventType
from mlflow.genai.agent_server import invoke


def _get_selected_provider() -> AssistantProvider | None:
    config = AssistantConfig.load()
    for name, cfg in config.providers.items():
        if cfg.selected:
            return next((p for p in list_providers() if p.name == name), None)
    return None


def _extract_prompt(request: dict[str, Any]) -> str:
    """Pull the most recent user message out of the playground request.

    Supports the playground's two payload shapes:
    - ``{"messages": [{"role": "user", "content": "..."}, ...]}`` (default)
    - ``{"input": [{"role": "user", "content": "..."}, ...]}`` (responses)
    Also accepts a bare ``prompt`` / ``input`` / ``message`` string for
    direct test invocations.
    """
    if direct := request.get("prompt") or request.get("message"):
        return direct

    for key in ("messages", "input"):
        items = request.get(key)
        if isinstance(items, str):
            return items
        if not isinstance(items, list):
            continue
        for item in reversed(items):
            if not isinstance(item, dict) or item.get("role") != "user":
                continue
            content = item.get("content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                texts = [
                    block.get("text", "")
                    for block in content
                    if isinstance(block, dict) and block.get("type") in (None, "text", "input_text")
                ]
                if joined := "".join(texts).strip():
                    return joined
    return ""


@invoke()
@mlflow.trace
async def chat(request: dict[str, Any]) -> dict[str, Any]:
    """Run one chat turn against the configured assistant provider.

    Args:
        request: Playground-supplied dict. Recognized keys:
            - prompt / input / message: user prompt (required)
            - session_id: provider session id for multi-turn continuity
            - tracking_uri: MLflow server URL (falls back to env)
            - cwd: working directory for tool execution
            - context: arbitrary UI context (experimentId, traceId, ...)

    Returns:
        Chat-style dict ``{"role": "assistant", "content": <text>}`` that the
        playground's ``_extract_assistant_text`` renders cleanly. ``error`` is
        added when the provider failed.
    """
    prompt = _extract_prompt(request)
    if not prompt:
        return {"role": "assistant", "content": "", "error": "No prompt provided in request"}

    # MLFLOW_TRACKING_URI may be a SQLite/file URI when the agent is launched
    # by the playground; only HTTP(S) URIs are usable for providers that call
    # the MLflow server (e.g. the AI Gateway).
    tracking_uri = next(
        (
            uri
            for uri in (
                request.get("tracking_uri"),
                os.environ.get("MLFLOW_TRACKING_URI"),
            )
            if isinstance(uri, str) and uri.startswith(("http://", "https://"))
        ),
        "http://localhost:5000",
    )
    session_id = request.get("session_id")
    cwd_value = request.get("cwd")
    cwd = Path(cwd_value) if cwd_value else None
    context = request.get("context")

    provider = _get_selected_provider()
    if provider is None:
        return {
            "role": "assistant",
            "content": "",
            "error": "No assistant provider is configured.",
        }

    # Both providers emit content_delta stream events for streaming text.
    # ClaudeCodeProvider additionally emits a final assistant Message with
    # the same text — accumulating only stream deltas avoids duplication.
    chunks: list[str] = []

    async for event in provider.astream(
        prompt=prompt,
        tracking_uri=tracking_uri,
        session_id=session_id,
        cwd=cwd,
        context=context,
    ):
        match event.type:
            case EventType.STREAM_EVENT:
                inner = event.data.get("event") or {}
                if inner.get("type") == "content_delta":
                    if text := (inner.get("delta") or {}).get("text"):
                        chunks.append(text)
            case EventType.ERROR:
                return {
                    "role": "assistant",
                    "content": "".join(chunks),
                    "error": event.data.get("error", "Unknown error"),
                }
            case EventType.INTERRUPTED:
                return {
                    "role": "assistant",
                    "content": "".join(chunks),
                    "error": event.data.get("message", "Assistant was interrupted"),
                }

    return {"role": "assistant", "content": "".join(chunks)}
