"""Runtime helpers for the MLflow Agent Playground."""

from __future__ import annotations

import atexit
import asyncio
import json
import os
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import click
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse

from mlflow.claude_code.playground_setup import (
    DEFAULT_CONFIG_DIR,
    DEFAULT_CONFIG_PATH,
    DEFAULT_EXPERIMENT_NAME,
    PlaygroundUserConfig,
    _default_tracking_uri,
    load_user_config,
    save_user_config,
)
from mlflow.playground.ui import PLAYGROUND_HTML
from mlflow.tracing.constant import SpanAttributeKey
from mlflow.tracking.client import MlflowClient

DEFAULT_AGENT_URL = "http://127.0.0.1:8000"
DEFAULT_REQUEST_TIMEOUT_SECONDS = 120.0
STREAM_CHUNK_DELAY_SECONDS = 0.016
DEFAULT_SERVER_HOST = "127.0.0.1"
DEFAULT_SERVER_PORT = 5000


@dataclass
class PlaygroundRuntime:
    agent_url: str = DEFAULT_AGENT_URL
    config_path: Path = DEFAULT_CONFIG_PATH
    request_timeout_seconds: float = DEFAULT_REQUEST_TIMEOUT_SECONDS
    repo_dir: Path | None = None
    agent_process: subprocess.Popen[Any] | None = None
    managed_agent_url: str | None = None
    process_lock: threading.Lock = field(default_factory=threading.Lock)


def _default_artifact_root() -> str:
    artifact_dir = (DEFAULT_CONFIG_DIR / "artifacts").resolve()
    artifact_dir.mkdir(parents=True, exist_ok=True)
    return artifact_dir.as_uri()


def _is_local_tracking_uri(uri: str) -> bool:
    # Schemes the embedded MLflow tracking server can use as a backend store.
    # An empty scheme means a relative file path.
    return urlsplit(uri).scheme in {"", "file", "sqlite", "mysql", "postgresql", "mssql"}


def _ensure_local_playground_config(
    *,
    config_path: Path,
    repo_dir: Path | None,
) -> PlaygroundUserConfig:
    """Resolve the playground config for this launch.

    The tracking URI is *never* persisted to the global config — it's derived
    fresh on every launch so that running ``mlflow agent playground`` from
    project A and then project B writes to two different sqlite files instead
    of merging into one global DB. ``MLFLOW_TRACKING_URI`` from the env wins,
    but only if it points at a local backend (sqlite / file / etc.) — the
    embedded MLflow server can't use a remote URI as its backend store.
    """
    config = load_user_config(config_path) or PlaygroundUserConfig()

    if not config.mlflow.experiment:
        config.mlflow.experiment = DEFAULT_EXPERIMENT_NAME

    if repo_dir is not None:
        config.playground.repo_dir = str(repo_dir.resolve())

    # Persist with a blank tracking_uri so the next run also derives from cwd.
    config.mlflow.tracking_uri = ""
    save_user_config(config, config_path)

    env_uri = os.environ.get("MLFLOW_TRACKING_URI", "").strip()
    if env_uri and not _is_local_tracking_uri(env_uri):
        click.echo(
            f"Ignoring MLFLOW_TRACKING_URI={env_uri!r} — the playground needs a "
            "local backend (sqlite / file). Falling back to the per-repo default."
        )
        env_uri = ""
    config.mlflow.tracking_uri = env_uri or _default_tracking_uri(repo_dir)
    return config


def _frontend_source_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "server" / "js"


def _mlflow_ui_index_path() -> Path:
    from mlflow.server import app as flask_app

    return Path(flask_app.static_folder) / "index.html"


def _ensure_mlflow_ui_assets() -> None:
    index_path = _mlflow_ui_index_path()
    if index_path.exists():
        return

    source_dir = _frontend_source_dir()
    package_json = source_dir / "package.json"
    if not package_json.exists():
        raise click.ClickException(
            "MLflow UI assets are missing and the frontend source tree is not available."
        )

    node_modules_dir = source_dir / "node_modules"
    if not node_modules_dir.exists():
        click.echo("Installing MLflow UI dependencies for local playground startup...")
        subprocess.run(["yarn", "install"], cwd=source_dir, check=True)

    click.echo("Building MLflow UI assets for local playground startup...")
    subprocess.run(["yarn", "build"], cwd=source_dir, check=True)

    if not index_path.exists():
        raise click.ClickException(
            "MLflow UI build completed but the generated index.html was not found."
        )


@contextmanager
def _temporary_env(overrides: dict[str, str | None]):
    original = {key: os.environ.get(key) for key in overrides}
    try:
        for key, value in overrides.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        yield
    finally:
        for key, value in original.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _normalize_agent_url(agent_url: str | None) -> str:
    candidate = agent_url or os.environ.get("MLFLOW_PLAYGROUND_AGENT_URL") or DEFAULT_AGENT_URL
    return candidate.rstrip("/")


def _load_playground_config(config_path: Path) -> dict[str, Any]:
    config = load_user_config(config_path)
    if config is None:
        return {
            "tracking_uri": "",
            "experiment": "",
            "tracing_enabled": False,
            "worker_kind": "claude-code",
            "repo_dir": "",
        }

    return {
        "tracking_uri": config.mlflow.tracking_uri,
        "experiment": config.mlflow.experiment,
        "tracing_enabled": config.playground.enable_tracing,
        "worker_kind": config.worker.kind,
        "repo_dir": config.playground.repo_dir,
    }


def _json_safe_load(value: Any) -> Any:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except Exception:
        return value


def _coerce_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, indent=2)


def _extract_assistant_text(payload: Any) -> str:
    if isinstance(payload, str):
        return payload

    if not isinstance(payload, dict):
        return _coerce_text(payload)

    if payload.get("role") == "assistant":
        content = payload.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict) and "text" in item:
                    parts.append(str(item["text"]))
                elif isinstance(item, str):
                    parts.append(item)
            return "".join(parts)

    if isinstance(payload.get("output"), list):
        parts = []
        for item in payload["output"]:
            if item.get("type") != "message":
                continue
            for content in item.get("content", []):
                if content.get("type") == "output_text":
                    parts.append(str(content.get("text", "")))
        if parts:
            return "".join(parts)

    if isinstance(payload.get("messages"), list):
        for item in reversed(payload["messages"]):
            if item.get("role") == "assistant":
                return _extract_assistant_text(item)

    if "content" in payload:
        return _coerce_text(payload["content"])

    return _coerce_text(payload)


def _extract_trace_id(payload: Any) -> str | None:
    if isinstance(payload, dict):
        metadata = payload.get("metadata")
        if isinstance(metadata, dict) and metadata.get("trace_id"):
            return str(metadata["trace_id"])
        if payload.get("trace_id"):
            return str(payload["trace_id"])
    return None


def _is_tool_span(span: Any) -> bool:
    span_type = getattr(span, "span_type", None)
    if span_type:
        return str(span_type).strip('"').upper() == "TOOL"

    attrs = getattr(span, "attributes", None) or {}
    raw = attrs.get(SpanAttributeKey.SPAN_TYPE)
    return str(_json_safe_load(raw)).strip('"').upper() == "TOOL"


def _extract_tool_calls(trace: Any) -> list[dict[str, Any]]:
    tool_spans = [span for span in getattr(trace.data, "spans", []) if _is_tool_span(span)]
    tool_spans.sort(key=lambda span: getattr(span, "start_time_ns", 0))
    results = []
    for span in tool_spans:
        duration_ms = None
        start_ns = getattr(span, "start_time_ns", None)
        end_ns = getattr(span, "end_time_ns", None)
        if start_ns is not None and end_ns is not None:
            duration_ms = round((end_ns - start_ns) / 1_000_000, 1)

        results.append({
            "name": span.name,
            "span_id": span.span_id,
            "duration_ms": duration_ms,
            "inputs": _json_safe_load(span.inputs),
            "outputs": _json_safe_load(span.outputs),
            "status": getattr(getattr(span, "status", None), "status_code", None),
        })
    return results


def _trace_payload(trace: Any) -> dict[str, Any]:
    trace_dict = trace.to_dict()
    info = trace_dict.get("info", {})
    return {
        "summary": {
            "trace_id": info.get("trace_id"),
            "request_time": info.get("request_time"),
            "state": info.get("state"),
            "execution_duration_ms": info.get("execution_duration"),
            "span_count": len(trace_dict.get("data", {}).get("spans", [])),
        },
        "tool_calls": _extract_tool_calls(trace),
        "trace": trace_dict,
    }


async def _detect_protocol(agent_url: str, timeout_seconds: float) -> str:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{agent_url}/agent/info")
        if response.is_success and response.json().get("agent_api") == "responses":
            return "responses"
    except Exception:
        pass
    return "messages"


def _resolve_repo_dir(config_path: Path) -> Path | None:
    configured = _load_playground_config(config_path).get("repo_dir")
    if configured:
        repo_dir = Path(configured).expanduser()
        if repo_dir.exists():
            return repo_dir

    cwd = Path.cwd()
    if cwd.exists():
        return cwd
    return None


def _is_loopback_agent_url(agent_url: str) -> bool:
    parsed = urlsplit(agent_url)
    return parsed.hostname in {"127.0.0.1", "localhost", "::1"}


def _is_agent_healthy_sync(agent_url: str, timeout_seconds: float = 1.5) -> bool:
    try:
        with httpx.Client(timeout=timeout_seconds) as client:
            response = client.get(f"{agent_url}/health")
        return response.is_success
    except Exception:
        return False


def _terminate_process(process: subprocess.Popen[Any]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


def _launch_local_agent_process(repo_dir: Path, agent_url: str) -> subprocess.Popen[Any]:
    parsed = urlsplit(agent_url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 8000
    command = [
        sys.executable,
        "-m",
        "mlflow.playground.agent_bootstrap",
        "--repo-dir",
        str(repo_dir),
        "--host",
        host,
        "--port",
        str(port),
    ]
    return subprocess.Popen(command, cwd=repo_dir)


def _wait_for_agent_health(agent_url: str, timeout_seconds: float = 20.0) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if _is_agent_healthy_sync(agent_url):
            return True
        time.sleep(0.25)
    return False


def _ensure_agent_running(runtime: PlaygroundRuntime, agent_url: str) -> bool:
    if _is_agent_healthy_sync(agent_url):
        return True

    if runtime.repo_dir is None or not _is_loopback_agent_url(agent_url):
        return False

    with runtime.process_lock:
        if _is_agent_healthy_sync(agent_url):
            return True

        process = runtime.agent_process
        if (
            process is not None
            and runtime.managed_agent_url == agent_url
            and process.poll() is None
            and _wait_for_agent_health(agent_url, timeout_seconds=3.0)
        ):
            return True

        process = _launch_local_agent_process(runtime.repo_dir, agent_url)
        runtime.agent_process = process
        runtime.managed_agent_url = agent_url
        atexit.register(_terminate_process, process)

    return _wait_for_agent_health(agent_url)


def _build_agent_payload(messages: list[dict[str, str]], protocol: str) -> dict[str, Any]:
    if protocol == "responses":
        return {
            "input": [
                {
                    "role": message["role"],
                    "content": message["content"],
                }
                for message in messages
            ]
        }
    return {
        "messages": [
            {
                "role": message["role"],
                "content": message["content"],
            }
            for message in messages
        ]
    }


async def _invoke_agent(
    *,
    agent_url: str,
    messages: list[dict[str, str]],
    timeout_seconds: float,
    request_id: str | None = None,
) -> tuple[dict[str, Any], str]:
    protocol = await _detect_protocol(agent_url, timeout_seconds)
    payload = _build_agent_payload(messages, protocol)

    headers = {"x-mlflow-return-trace-id": "true"}
    if request_id:
        headers["x-mlflow-trace-tags"] = json.dumps(
            {"playground.request_id": request_id}
        )

    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        response = await client.post(
            f"{agent_url}/invocations",
            headers=headers,
            json=payload,
        )

    if not response.is_success:
        raise HTTPException(
            status_code=response.status_code,
            detail=response.text or "Agent invocation failed.",
        )

    try:
        return response.json(), protocol
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Invalid agent response: {exc}") from exc


def _fetch_trace(config_path: Path, trace_id: str) -> dict[str, Any]:
    config = _load_playground_config(config_path)
    tracking_uri = config["tracking_uri"]
    if not tracking_uri:
        raise HTTPException(
            status_code=404,
            detail="No tracking URI configured for this playground.",
        )

    client = MlflowClient(tracking_uri=tracking_uri)
    trace = client.get_trace(trace_id, display=False, flush=True)
    return _trace_payload(trace)


def _dispatch_feedback(
    config_path: Path,
    *,
    rationale: str,
    failing_assistant_message: str,
    conversation_prefix: list[dict[str, Any]],
    expected_response: str | None = None,
    aspect: str | None = None,
    experiment_id: str | None = None,
    source_trace_id: str | None = None,
    source_feedback_id: str | None = None,
) -> dict[str, Any]:
    """Dispatch a piece of cockpit feedback into the playground (design.md §6.2).

    Generates a runnable test case (YUK-14), creates the Issue with playground
    lineage (YUK-13), and appends the test row to the regression dataset
    (YUK-15). Returns the new ids and the dataset name. Raises ``ValueError``
    if the experiment cannot be resolved; lets generator / store / dataset
    errors propagate so the caller can map them to HTTP status codes.
    """
    from mlflow.entities.issue import IssueStatus
    from mlflow.playground.regression_suite import (
        append_test_case,
        regression_dataset_name,
    )
    from mlflow.playground.test_case_generator import (
        FeedbackInput,
        TestCaseGenerator,
    )
    from mlflow.tracking._tracking_service.utils import _get_store

    config = _load_playground_config(config_path)
    if experiment_id is None:
        experiment_id = _ensure_experiment_id(
            config["tracking_uri"], config["experiment"]
        )
    if experiment_id is None:
        raise ValueError(
            "experiment_id was not provided and could not be resolved from the "
            "playground config — start `mlflow agent playground` first or pass "
            "`experiment_id` explicitly."
        )

    feedback = FeedbackInput(
        rationale=rationale,
        failing_assistant_message=failing_assistant_message,
        conversation_prefix=conversation_prefix,
        expected_response=expected_response,
        aspect=aspect,
    )
    test_case = TestCaseGenerator().generate(feedback)

    store = _get_store()
    title = (rationale.strip().splitlines() or ["Untitled"])[0][:60] or "Untitled"
    issue = store.create_issue(
        experiment_id=experiment_id,
        name=title,
        description=rationale,
        status=IssueStatus.TODO,
        source_trace_id=source_trace_id,
        source_feedback_id=source_feedback_id,
    )

    append_test_case(
        experiment_id,
        test_case,
        issue_id=issue.issue_id,
        source_trace_id=source_trace_id,
    )

    return {
        "issue_id": issue.issue_id,
        "test_case_id": test_case.test_case_id,
        "dataset_name": regression_dataset_name(experiment_id),
    }


def _chunk_text(text: str) -> list[str]:
    if not text:
        return [""]
    chunks = []
    cursor = 0
    while cursor < len(text):
        next_stop = min(len(text), cursor + 12)
        while next_stop < len(text) and text[next_stop - 1] not in {" ", "\n", "\t", ".", ",", "!", "?"}:
            next_stop += 1
            if next_stop - cursor >= 22:
                break
        chunks.append(text[cursor:next_stop])
        cursor = next_stop
    return chunks


async def _demo_stream_response(
    *,
    text: str,
    trace_id: str | None,
    tool_calls: list[dict[str, Any]],
    protocol: str,
) -> Any:
    for chunk in _chunk_text(text):
        yield f"data: {json.dumps({'type': 'assistant_delta', 'delta': chunk})}\n\n"
        await asyncio.sleep(STREAM_CHUNK_DELAY_SECONDS)

    yield (
        "data: "
        + json.dumps({
            "type": "assistant_final",
            "message": {"role": "assistant", "content": text},
            "trace_id": trace_id,
            "tool_calls": tool_calls,
            "protocol": protocol,
        })
        + "\n\n"
    )
    yield "data: " + json.dumps({"type": "done"}) + "\n\n"


def create_app(
    *,
    agent_url: str | None = None,
    config_path: Path = DEFAULT_CONFIG_PATH,
) -> FastAPI:
    app = FastAPI(title="MLflow Agent Playground")
    runtime = PlaygroundRuntime(
        agent_url=_normalize_agent_url(agent_url),
        config_path=config_path,
        repo_dir=_resolve_repo_dir(config_path),
    )

    @app.get("/playground", response_class=HTMLResponse)
    def playground() -> str:
        return PLAYGROUND_HTML

    @app.get("/", response_class=HTMLResponse)
    def root() -> str:
        return PLAYGROUND_HTML

    @app.get("/playground/api/config")
    async def get_config() -> dict[str, Any]:
        await asyncio.to_thread(_ensure_agent_running, runtime, runtime.agent_url)
        config = _load_playground_config(runtime.config_path)
        return {
            **config,
            "agent_url": runtime.agent_url,
            "agent_connected": _is_agent_healthy_sync(runtime.agent_url),
        }

    @app.post("/playground/api/config")
    async def probe_agent(request: dict[str, Any]) -> dict[str, Any]:
        agent_url = _normalize_agent_url(request.get("agent_url"))
        await asyncio.to_thread(_ensure_agent_running, runtime, agent_url)
        protocol = await _detect_protocol(agent_url, runtime.request_timeout_seconds)

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{agent_url}/health")
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Could not reach agent: {exc}") from exc
        if not response.is_success:
            raise HTTPException(status_code=502, detail="Agent health check failed.")

        runtime.agent_url = agent_url
        return {"connected": True, "protocol": protocol, "agent_url": agent_url}

    @app.post("/playground/api/chat")
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
                trace_payload = await asyncio.to_thread(_fetch_trace, runtime.config_path, trace_id)
                tool_calls = trace_payload["tool_calls"]
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

    @app.get("/playground/api/traces/{trace_id}")
    async def get_trace(trace_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(_fetch_trace, runtime.config_path, trace_id)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "stage": "epic-2-demo"}

    return app


def pick_free_port(host: str) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return sock.getsockname()[1]


def build_url(host: str, port: int, experiment_id: str | None) -> str:
    base = f"http://{host}:{port}"
    if experiment_id:
        return f"{base}/#/experiments/{experiment_id}/playground"
    # No experiment yet — drop the user on the experiments list so they can pick one.
    return f"{base}/#/experiments"


def _ensure_experiment_id(tracking_uri: str, experiment_name: str) -> str | None:
    """Resolve `experiment_name` to its id against `tracking_uri`, creating it if missing.

    Returns None if the lookup/creation fails (e.g. the URI isn't reachable yet).
    """
    if not tracking_uri or not experiment_name:
        return None
    try:
        from mlflow.tracking.client import MlflowClient

        client = MlflowClient(tracking_uri=tracking_uri)
        existing = client.get_experiment_by_name(experiment_name)
        if existing is not None:
            return existing.experiment_id
        return client.create_experiment(experiment_name)
    except Exception:
        return None


def _open_browser_after_delay(url: str, delay: float = 0.5) -> None:
    time.sleep(delay)
    webbrowser.open(url)


def serve(
    host: str = DEFAULT_SERVER_HOST,
    port: int = DEFAULT_SERVER_PORT,
    open_browser: bool = True,
    reload: bool = False,
    agent_url: str | None = None,
) -> None:
    """Start the local MLflow-backed playground flow. Blocks until interrupted."""
    from mlflow.server import _run_server

    repo_dir = Path.cwd()
    config = _ensure_local_playground_config(config_path=DEFAULT_CONFIG_PATH, repo_dir=repo_dir)
    backend_store_uri = config.mlflow.tracking_uri
    experiment_name = config.mlflow.experiment
    normalized_agent_url = _normalize_agent_url(agent_url)

    _ensure_mlflow_ui_assets()

    experiment_id = _ensure_experiment_id(backend_store_uri, experiment_name)
    url = build_url(host, port, experiment_id)
    if open_browser:
        threading.Thread(target=_open_browser_after_delay, args=(url,), daemon=True).start()

    click.echo(f"MLflow Agent Playground starting at {url}")
    click.echo("Press Ctrl+C to stop.")
    click.echo(f"Tracking backend: {backend_store_uri}")
    click.echo(f"Experiment: {experiment_name}")
    click.echo(f"Agent endpoint: {normalized_agent_url}")
    click.echo("Local agent auto-start: enabled for loopback URLs when an @invoke repo is available.")

    env_overrides = {
        "MLFLOW_TRACKING_URI": backend_store_uri,
        "MLFLOW_EXPERIMENT_NAME": experiment_name,
        "MLFLOW_PLAYGROUND_AGENT_URL": normalized_agent_url,
        "MLFLOW_ENABLE_WORKSPACES": "false",
    }

    uvicorn_opts = "--reload --log-level debug" if reload else None
    with _temporary_env(env_overrides):
        _run_server(
            file_store_path=backend_store_uri,
            registry_store_uri=backend_store_uri,
            default_artifact_root=_default_artifact_root(),
            serve_artifacts=True,
            artifacts_only=False,
            artifacts_destination=None,
            host=host,
            port=port,
            static_prefix=None,
            workers=None,
            gunicorn_opts=None,
            waitress_opts=None,
            expose_prometheus=None,
            app_name=None,
            uvicorn_opts=uvicorn_opts,
            env_file=None,
            secrets_cache_ttl=60,
            secrets_cache_max_size=1000,
        )
