from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from mlflow.claude_code.playground_setup import DEFAULT_CONFIG_PATH
from mlflow.playground.server import (
    PlaygroundRuntime,
    _demo_stream_response,
    _ensure_agent_running,
    _extract_assistant_text,
    _extract_tool_calls,
    _extract_trace_id,
    _invoke_agent,
    _is_agent_healthy_sync,
    _load_playground_config,
    _normalize_agent_url,
    _resolve_repo_dir,
)
from mlflow.tracking.client import MlflowClient


def _fetch_tool_calls_from_trace(config_path: Path, trace_id: str) -> list[dict[str, Any]]:
    config = _load_playground_config(config_path)
    tracking_uri = config["tracking_uri"]
    if not tracking_uri:
        return []

    client = MlflowClient(tracking_uri=tracking_uri)
    trace = client.get_trace(trace_id, display=False, flush=True)
    return _extract_tool_calls(trace)


def create_playground_api_router(
    *,
    agent_url: str | None = None,
    config_path: Path = DEFAULT_CONFIG_PATH,
) -> APIRouter:
    router = APIRouter(prefix="/ajax-api/3.0/mlflow/playground", tags=["playground"])
    runtime = PlaygroundRuntime(
        agent_url=_normalize_agent_url(agent_url),
        config_path=config_path,
        repo_dir=_resolve_repo_dir(config_path),
    )

    @router.get("/config")
    async def get_config() -> dict[str, Any]:
        await asyncio.to_thread(_ensure_agent_running, runtime, runtime.agent_url)
        config = _load_playground_config(runtime.config_path)
        return {
            **config,
            "agent_url": runtime.agent_url,
            "agent_connected": _is_agent_healthy_sync(runtime.agent_url),
        }

    @router.post("/config")
    async def probe_agent(request: dict[str, Any]) -> dict[str, Any]:
        agent_url = _normalize_agent_url(request.get("agent_url"))
        await asyncio.to_thread(_ensure_agent_running, runtime, agent_url)

        if not _is_agent_healthy_sync(agent_url):
            raise HTTPException(status_code=502, detail="Agent health check failed.")

        runtime.agent_url = agent_url
        return {"connected": True, "agent_url": agent_url}

    @router.post("/chat")
    async def chat(request: dict[str, Any]) -> StreamingResponse:
        messages = request.get("messages")
        if not isinstance(messages, list) or not messages:
            raise HTTPException(status_code=400, detail="`messages` must be a non-empty list.")

        normalized_messages = []
        for message in messages:
            role = message.get("role")
            content = message.get("content")
            if role not in {"user", "assistant", "system", "developer"}:
                raise HTTPException(status_code=400, detail=f"Unsupported role: {role}")
            if not isinstance(content, str):
                raise HTTPException(status_code=400, detail="Message content must be a string.")
            normalized_messages.append({"role": role, "content": content})

        agent_url = _normalize_agent_url(request.get("agent_url") or runtime.agent_url)
        request_id = request.get("request_id")
        if request_id is not None and not isinstance(request_id, str):
            raise HTTPException(status_code=400, detail="`request_id` must be a string.")
        await asyncio.to_thread(_ensure_agent_running, runtime, agent_url)
        response_json, protocol = await _invoke_agent(
            agent_url=agent_url,
            messages=normalized_messages,
            timeout_seconds=runtime.request_timeout_seconds,
            request_id=request_id,
        )
        runtime.agent_url = agent_url

        assistant_text = _extract_assistant_text(response_json)
        trace_id = _extract_trace_id(response_json)
        tool_calls: list[dict[str, Any]] = []
        if trace_id:
            try:
                tool_calls = await asyncio.to_thread(
                    _fetch_tool_calls_from_trace,
                    runtime.config_path,
                    trace_id,
                )
            except Exception:
                tool_calls = []

        return StreamingResponse(
            _demo_stream_response(
                text=assistant_text,
                trace_id=trace_id,
                tool_calls=tool_calls,
                protocol=protocol,
            ),
            media_type="text/event-stream",
        )

    return router
