from __future__ import annotations

import asyncio
import subprocess
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from mlflow.claude_code.playground_setup import DEFAULT_CONFIG_PATH
from mlflow.playground.server import (
    AgentConnection,
    PlaygroundRuntime,
    _demo_stream_response,
    _dispatch_feedback,
    _ensure_agent_running,
    _extract_assistant_text,
    _extract_tool_calls,
    _extract_trace_id,
    _invoke_agent,
    _is_agent_healthy_sync,
    _json_safe_load,
    _load_playground_config,
    _new_connection_id,
    _normalize_agent_url,
    _resolve_repo_dir,
    register_main_connection,
    start_health_poll_thread,
)
from mlflow.tracing.constant import TraceMetadataKey
from mlflow.tracking.client import MlflowClient

SESSION_LIST_MAX_TRACES = 500
SESSION_LIST_MAX_SESSIONS = 50
SESSION_PREVIEW_MAX_CHARS = 80
PLAYGROUND_REQUEST_ID_TAG = "playground.request_id"


def _lookup_trace_id_by_request_id(experiment_id: str, request_id: str) -> str | None:
    """Find a freshly-emitted trace by its ``playground.request_id`` tag.

    Used by paths that need to know the trace_id but invoke a non-ResponsesAgent
    (where ``_extract_trace_id`` on the response returns None because the
    agent server only adds ``metadata.trace_id`` for ResponsesAgent).
    Returns None on any error so the caller can degrade to "no trace pane".
    """
    try:
        client = MlflowClient()
        traces = client.search_traces(
            experiment_ids=[experiment_id],
            filter_string=f"tags.`{PLAYGROUND_REQUEST_ID_TAG}` = '{request_id}'",
            max_results=1,
        )
        if not traces:
            return None
        info = getattr(traces[0], "info", None) or traces[0]
        return getattr(info, "trace_id", None)
    except Exception:
        return None


def _fetch_tool_calls_from_trace(config_path: Path, trace_id: str) -> list[dict[str, Any]]:
    config = _load_playground_config(config_path)
    tracking_uri = config["tracking_uri"]
    if not tracking_uri:
        return []

    client = MlflowClient(tracking_uri=tracking_uri)
    trace = client.get_trace(trace_id, display=False, flush=True)
    return _extract_tool_calls(trace)


def _root_span(trace: Any) -> Any | None:
    spans = getattr(trace.data, "spans", []) or []
    return next(
        (
            s
            for s in spans
            if not getattr(s, "parent_id", None) and not getattr(s, "parent_span_id", None)
        ),
        spans[0] if spans else None,
    )


def _last_user_content(inputs: Any) -> str:
    """Pull the most recent user message text from a root-span inputs payload.

    Handles both messages-protocol (`{"messages": [...]}`) and responses-protocol
    (`{"input": [...]}`) shapes that `_build_agent_payload` produces.
    """
    if isinstance(inputs, str):
        return inputs
    if not isinstance(inputs, dict):
        return ""
    for key in ("messages", "input"):
        items = inputs.get(key)
        if isinstance(items, list):
            for item in reversed(items):
                if isinstance(item, dict) and item.get("role") == "user":
                    content = item.get("content")
                    if isinstance(content, str):
                        return content
                    if isinstance(content, list):
                        # responses-protocol may wrap text under [{type:..., text:...}]
                        return "".join(
                            str(p.get("text", "")) for p in content if isinstance(p, dict)
                        )
    return ""


def _truncate(text: str, limit: int) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _session_id_of(trace_info: Any) -> str | None:
    metadata = getattr(trace_info, "trace_metadata", None) or {}
    value = metadata.get(TraceMetadataKey.TRACE_SESSION)
    return value if isinstance(value, str) and value else None


def _list_session_summaries(config_path: Path) -> list[dict[str, Any]]:
    config = _load_playground_config(config_path)
    tracking_uri = config["tracking_uri"]
    experiment_name = config.get("experiment")
    if not tracking_uri or not experiment_name:
        return []

    client = MlflowClient(tracking_uri=tracking_uri)
    experiment = client.get_experiment_by_name(experiment_name)
    if experiment is None:
        return []

    traces = client.search_traces(
        experiment_ids=[experiment.experiment_id],
        order_by=["timestamp_ms DESC"],
        max_results=SESSION_LIST_MAX_TRACES,
        include_spans=False,
    )

    grouped: dict[str, dict[str, Any]] = {}
    for trace in traces:
        info = getattr(trace, "info", None) or trace
        session_id = _session_id_of(info)
        if not session_id:
            continue
        bucket = grouped.setdefault(
            session_id,
            {
                "session_id": session_id,
                "trace_count": 0,
                "first_activity_ms": getattr(info, "request_time", 0),
                "last_activity_ms": getattr(info, "request_time", 0),
                "preview": "",
                "_earliest_request_preview": None,
                "_earliest_request_time": None,
            },
        )
        bucket["trace_count"] += 1
        request_time = getattr(info, "request_time", 0) or 0
        if request_time > bucket["last_activity_ms"]:
            bucket["last_activity_ms"] = request_time
        if request_time < bucket["first_activity_ms"] or bucket["first_activity_ms"] == 0:
            bucket["first_activity_ms"] = request_time
        # Track the earliest trace's request_preview to derive the session preview.
        if (
            bucket["_earliest_request_time"] is None
            or request_time < bucket["_earliest_request_time"]
        ):
            bucket["_earliest_request_time"] = request_time
            bucket["_earliest_request_preview"] = getattr(info, "request_preview", None)

    summaries = []
    for bucket in grouped.values():
        preview_source = bucket.pop("_earliest_request_preview", None)
        bucket.pop("_earliest_request_time", None)
        if isinstance(preview_source, str) and preview_source:
            parsed = _json_safe_load(preview_source)
            preview_text = _last_user_content(parsed) or preview_source
        else:
            preview_text = ""
        bucket["preview"] = _truncate(preview_text, SESSION_PREVIEW_MAX_CHARS)
        summaries.append(bucket)

    summaries.sort(key=lambda s: s["last_activity_ms"], reverse=True)
    return summaries[:SESSION_LIST_MAX_SESSIONS]


def _rehydrate_session(config_path: Path, session_id: str) -> dict[str, Any]:
    config = _load_playground_config(config_path)
    tracking_uri = config["tracking_uri"]
    experiment_name = config.get("experiment")
    if not tracking_uri or not experiment_name:
        raise HTTPException(
            status_code=404,
            detail="Tracking URI or experiment is not configured for this playground.",
        )

    client = MlflowClient(tracking_uri=tracking_uri)
    experiment = client.get_experiment_by_name(experiment_name)
    if experiment is None:
        raise HTTPException(status_code=404, detail=f"Experiment {experiment_name!r} not found.")

    traces = client.search_traces(
        experiment_ids=[experiment.experiment_id],
        filter_string=f"metadata.`{TraceMetadataKey.TRACE_SESSION}` = '{session_id}'",
        order_by=["timestamp_ms ASC"],
        max_results=SESSION_LIST_MAX_TRACES,
        include_spans=True,
    )

    messages: list[dict[str, Any]] = []
    trace_ids_by_request_id: dict[str, str] = {}
    assessments: list[dict[str, Any]] = []

    for trace in traces:
        info = trace.info
        trace_id = info.trace_id
        request_id = (info.tags or {}).get(PLAYGROUND_REQUEST_ID_TAG)

        root = _root_span(trace)
        user_content = ""
        assistant_content = ""
        tool_calls: list[dict[str, Any]] = []
        if root is not None:
            user_content = _last_user_content(_json_safe_load(root.inputs))
            assistant_content = _extract_assistant_text(_json_safe_load(root.outputs))
            tool_calls = _extract_tool_calls(trace)

        if request_id and trace_id:
            trace_ids_by_request_id[request_id] = trace_id

        if user_content:
            messages.append({
                "id": f"user-{trace_id}",
                "role": "user",
                "content": user_content,
                "requestId": request_id,
            })
        if assistant_content or tool_calls:
            messages.append({
                "id": f"assistant-{trace_id}",
                "role": "assistant",
                "content": assistant_content,
                "requestId": request_id,
                "toolCalls": tool_calls,
            })

        for assessment in info.assessments or []:
            assessments.append({
                "trace_id": trace_id,
                "assessment": assessment.to_dictionary(),
            })

    return {
        "session_id": session_id,
        "messages": messages,
        "traceIdsByRequestId": trace_ids_by_request_id,
        "assessments": assessments,
    }


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
    # Epic 8 / YUK-47: register the launched agent as `main` and start the
    # health-poll thread. Workers self-register later via `mlflow agent connect`.
    register_main_connection(runtime)
    start_health_poll_thread(runtime)

    def _active_agent_url() -> str:
        """Return the URL of the active connection (or runtime default)."""
        with runtime.connections_lock:
            active_id = runtime.active_connection_id
            if active_id and active_id in runtime.connections:
                return runtime.connections[active_id].agent_url
        return runtime.agent_url

    def _update_main_agent_url(agent_url: str) -> None:
        """/config POST swaps the main agent — keep registry in sync."""
        runtime.agent_url = agent_url
        with runtime.connections_lock:
            for connection in runtime.connections.values():
                if connection.name == "main":
                    connection.agent_url = agent_url
                    connection.consecutive_health_failures = 0
                    if connection.status == "dead":
                        connection.status = "ready"
                    break

    @router.get("/config")
    async def get_config() -> dict[str, Any]:
        agent_url = _active_agent_url()
        await asyncio.to_thread(_ensure_agent_running, runtime, agent_url)
        config = _load_playground_config(runtime.config_path)
        return {
            **config,
            "agent_url": agent_url,
            "agent_connected": _is_agent_healthy_sync(agent_url),
        }

    @router.post("/config")
    async def probe_agent(request: dict[str, Any]) -> dict[str, Any]:
        agent_url = _normalize_agent_url(request.get("agent_url"))
        await asyncio.to_thread(_ensure_agent_running, runtime, agent_url)

        if not _is_agent_healthy_sync(agent_url):
            raise HTTPException(status_code=502, detail="Agent health check failed.")

        _update_main_agent_url(agent_url)
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

        agent_url = _normalize_agent_url(request.get("agent_url") or _active_agent_url())
        request_id = request.get("request_id")
        if request_id is not None and not isinstance(request_id, str):
            raise HTTPException(status_code=400, detail="`request_id` must be a string.")
        session_id = request.get("session_id")
        if session_id is not None and not isinstance(session_id, str):
            raise HTTPException(status_code=400, detail="`session_id` must be a string.")
        # If we manage the local agent subprocess, ensure it's healthy before
        # POSTing — otherwise the POST blows up with a raw httpx.ConnectError.
        # Returning a clean 502 lets the UI surface a real error message.
        started = await asyncio.to_thread(_ensure_agent_running, runtime, agent_url)
        if not started and not _is_agent_healthy_sync(agent_url):
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Agent at {agent_url} is not reachable. Check that the "
                    "agent process started successfully (look for errors in the "
                    "playground server logs). Common causes: no @invoke() "
                    "function found in the repo, an import error in the agent "
                    "file, or the port is held by another process."
                ),
            )
        response_json, protocol = await _invoke_agent(
            agent_url=agent_url,
            messages=normalized_messages,
            timeout_seconds=runtime.request_timeout_seconds,
            request_id=request_id,
            session_id=session_id,
        )

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

        # Whoever owns the active connection — `main` or a worker — should
        # see its agent_url reflect what `/chat` actually hit, in case the
        # caller passed an explicit override.
        with runtime.connections_lock:
            active_id = runtime.active_connection_id
            if active_id and active_id in runtime.connections:
                runtime.connections[active_id].agent_url = agent_url
            if runtime.connections.get(active_id) and runtime.connections[active_id].name == "main":
                runtime.agent_url = agent_url

        return StreamingResponse(
            _demo_stream_response(
                text=assistant_text,
                trace_id=trace_id,
                tool_calls=tool_calls,
                protocol=protocol,
            ),
            media_type="text/event-stream",
        )

    @router.get("/sessions")
    async def list_sessions() -> dict[str, Any]:
        sessions = await asyncio.to_thread(_list_session_summaries, runtime.config_path)
        return {"sessions": sessions}

    @router.get("/sessions/{session_id}")
    async def get_session(session_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(_rehydrate_session, runtime.config_path, session_id)

    @router.get("/issues")
    async def list_issues(
        experiment_id: str,
        state: str | None = None,
        max_results: int = 200,
    ) -> dict[str, Any]:
        """List Issues for an experiment, grouped/filtered by state.

        Backs the kanban board: the UI buckets the response by ``status`` into
        the five state-machine columns. ``state`` is an optional pre-filter
        (passed through as ``status = '...'`` to ``search_issues``); when
        omitted the caller groups client-side.
        """
        from mlflow.exceptions import MlflowException
        from mlflow.tracking._tracking_service.utils import _get_store

        filter_string = f"status = '{state}'" if state else None
        try:
            page = await asyncio.to_thread(
                _get_store().search_issues,
                experiment_id=experiment_id,
                filter_string=filter_string,
                max_results=max_results,
                include_trace_count=False,
            )
        except MlflowException as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"issues": [issue.to_dictionary() for issue in page]}

    @router.get("/issues/{issue_id}")
    async def get_issue(issue_id: str) -> dict[str, Any]:
        """Light-weight wrapper around the tracking-store ``get_issue`` so
        the cockpit doesn't have to chase MlflowClient initialisation.
        """
        from mlflow.exceptions import MlflowException
        from mlflow.tracking._tracking_service.utils import _get_store

        try:
            issue = await asyncio.to_thread(_get_store().get_issue, issue_id)
        except MlflowException as exc:
            status = 404 if "not found" in str(exc).lower() else 400
            raise HTTPException(status_code=status, detail=str(exc)) from exc
        return issue.to_dictionary()

    @router.get("/issues/{issue_id}/test-case")
    async def get_issue_test_case(issue_id: str) -> dict[str, Any]:
        """Return the regression-suite row generated for this Issue, so the
        UI can preview the test before running it.

        Match strategy mirrors ``run_test``: prefer ``test_case_id`` when the
        Issue carries one, otherwise fall back to the row's ``issue_id`` tag.
        Returns ``{messages, test_spec, tags}`` — everything the cockpit needs
        to render the test case panel — or 404 if the row hasn't been
        generated yet.
        """
        from mlflow.exceptions import MlflowException
        from mlflow.playground.regression_suite import get_or_create_regression_dataset
        from mlflow.tracking._tracking_service.utils import _get_store

        store = _get_store()
        try:
            issue = await asyncio.to_thread(store.get_issue, issue_id)
        except MlflowException as exc:
            status = 404 if "not found" in str(exc).lower() else 400
            raise HTTPException(status_code=status, detail=str(exc)) from exc

        dataset = await asyncio.to_thread(
            get_or_create_regression_dataset, str(issue.experiment_id)
        )
        df = await asyncio.to_thread(dataset.to_df)
        rows = df.to_dict(orient="records") if not df.empty else []
        match = None
        for row in rows:
            expectations = row.get("expectations") or {}
            if issue.test_case_id and expectations.get("test_case_id") == issue.test_case_id:
                match = row
                break
            tags = row.get("tags") or {}
            if tags.get("issue_id") == issue_id:
                match = row
                break
        if match is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No regression-suite row found for issue {issue_id!r}. "
                    "Has the test case been generated yet?"
                ),
            )

        expectations = match.get("expectations") or {}
        return {
            "messages": (match.get("inputs") or {}).get("messages") or [],
            "test_spec": expectations.get("test_spec") or {},
            "expected_response": expectations.get("expected_response"),
            "tags": match.get("tags") or {},
        }

    @router.get("/question-bank")
    async def list_question_bank(experiment_id: str) -> dict[str, Any]:
        """Return saved questions for the chip strip above the chat input.

        The bank is an ``EvaluationDataset`` of inputs-only records — a
        per-experiment, lightweight curated probe list (no assertions, no
        verdicts). Caller filters by experiment; returned in insertion
        order (the cockpit reverses for "newest left").
        """
        from mlflow.playground.question_bank import list_questions

        try:
            questions = await asyncio.to_thread(list_questions, experiment_id)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return {"experiment_id": experiment_id, "questions": questions}

    @router.post("/question-bank/add")
    async def add_to_question_bank(request: dict[str, Any]) -> dict[str, Any]:
        experiment_id = request.get("experiment_id")
        question = request.get("question")
        source_message_id = request.get("source_message_id")
        if not isinstance(experiment_id, str) or not experiment_id:
            raise HTTPException(
                status_code=400, detail="`experiment_id` must be a non-empty string."
            )
        if not isinstance(question, str) or not question.strip():
            raise HTTPException(status_code=400, detail="`question` must be a non-empty string.")
        if source_message_id is not None and not isinstance(source_message_id, str):
            raise HTTPException(
                status_code=400, detail="`source_message_id` must be a string when provided."
            )

        from mlflow.playground.question_bank import add_question

        try:
            question_id = await asyncio.to_thread(
                add_question,
                experiment_id,
                question.strip(),
                source_message_id=source_message_id,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return {"question_id": question_id}

    @router.delete("/question-bank/{question_id}")
    async def delete_from_question_bank(question_id: str, experiment_id: str) -> dict[str, Any]:
        """Remove one question. No-op if the id doesn't exist (HTTP-DELETE
        idempotency — double-click in the UI shouldn't 404).
        """
        from mlflow.playground.question_bank import delete_question

        try:
            await asyncio.to_thread(delete_question, experiment_id, question_id)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return {"deleted": question_id}

    @router.get("/regression-suite/cases")
    async def list_regression_cases(experiment_id: str) -> dict[str, Any]:
        """Return the cockpit-shaped view of every test case in an experiment's
        regression dataset. Each row is reduced to what the playground's
        Browse-suite drawer needs to render: the input question (last user
        message), the strategy + assertion or judge details, the originating
        feedback's issue id, and the source trace id. The full conversation
        prefix and raw spec stay available under ``raw`` for callers that
        want to drill in.

        We deliberately don't expose the underlying EvaluationDataset row
        model directly — its ``inputs`` / ``expectations`` / ``tags`` shape
        is generic and harder to scan in a card list. The transform here
        keeps the UI thin.
        """
        from mlflow.playground.regression_suite import (
            get_or_create_regression_dataset,
            regression_dataset_name,
        )

        try:
            dataset = await asyncio.to_thread(get_or_create_regression_dataset, experiment_id)
            df = await asyncio.to_thread(dataset.to_df)
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Could not load regression dataset for experiment {experiment_id!r}: {exc}",
            ) from exc

        rows = df.to_dict(orient="records") if not df.empty else []
        cases = []
        for row in rows:
            inputs = row.get("inputs") or {}
            messages = inputs.get("messages") or []
            # The "input question" is the last user message in the prefix —
            # that's what the assistant was responding to when the failing
            # turn happened.
            input_question = ""
            for msg in reversed(messages):
                if isinstance(msg, dict) and msg.get("role") == "user":
                    input_question = str(msg.get("content") or "")
                    break

            expectations = row.get("expectations") or {}
            spec = expectations.get("test_spec") or {}
            tags = row.get("tags") or {}

            cases.append({
                "test_case_id": expectations.get("test_case_id"),
                "rationale_summary": expectations.get("rationale_summary") or "",
                "input_question": input_question,
                "conversation_prefix": messages,
                "strategy": spec.get("strategy"),
                "assertion": spec.get("assertion"),
                "judge": spec.get("judge"),
                "expected_response": expectations.get("expected_response"),
                "issue_id": tags.get("issue_id"),
                "source_trace_id": tags.get("source_trace_id"),
                "promoted": tags.get("promoted") == "true",
            })

        return {
            "dataset_name": regression_dataset_name(experiment_id),
            "experiment_id": experiment_id,
            "cases": cases,
        }

    @router.post("/issues/{issue_id}/run-test")
    async def run_test(issue_id: str) -> dict[str, Any]:
        """Run the regression test for an Issue against the user's local
        agent and, on green, transition the Issue to ``done`` (the
        ``[I fixed this]`` flow described in design.md §6.5).

        Body is currently empty — the agent URL comes from the runtime,
        and everything else is resolved from the Issue + the regression
        dataset row.
        """
        from mlflow.entities.issue import IssueStatus
        from mlflow.exceptions import MlflowException
        from mlflow.playground.regression_suite import get_or_create_regression_dataset
        from mlflow.playground.test_runner import evaluate, normalize_agent_response
        from mlflow.tracking._tracking_service.utils import _get_store

        store = _get_store()
        try:
            issue = await asyncio.to_thread(store.get_issue, issue_id)
        except MlflowException as exc:
            status = 404 if "not found" in str(exc).lower() else 400
            raise HTTPException(status_code=status, detail=str(exc)) from exc

        if issue.status in (IssueStatus.PENDING, IssueStatus.RESOLVED):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Legacy detection-path issues aren't runnable through the "
                    "playground; use the discovery flow instead."
                ),
            )

        # Resolve the test row by issue_id (or test_case_id when present).
        dataset = await asyncio.to_thread(
            get_or_create_regression_dataset, str(issue.experiment_id)
        )
        df = await asyncio.to_thread(dataset.to_df)
        rows = df.to_dict(orient="records") if not df.empty else []
        match = None
        for row in rows:
            expectations = row.get("expectations") or {}
            if issue.test_case_id and expectations.get("test_case_id") == issue.test_case_id:
                match = row
                break
            tags = row.get("tags") or {}
            if tags.get("issue_id") == issue_id:
                match = row
                break
        if match is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    f"No regression-suite row found for issue {issue_id!r}. "
                    "Has the test case been generated yet?"
                ),
            )

        expectations = match.get("expectations") or {}
        spec = expectations.get("test_spec") or {}
        messages = (match.get("inputs") or {}).get("messages")
        if not isinstance(messages, list) or not isinstance(spec, dict):
            raise HTTPException(
                status_code=500,
                detail="Regression-suite row is malformed (missing inputs.messages or test_spec).",
            )

        # Hit the user's agent. Reuse the same invocation path the chat
        # endpoint uses so protocol detection and payload shaping match.
        try:
            raw, _protocol = await _invoke_agent(
                agent_url=_active_agent_url(),
                messages=messages,
                timeout_seconds=120.0,
            )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Agent invocation failed: {exc}") from exc

        response = normalize_agent_response(raw)
        verdict = await asyncio.to_thread(evaluate, spec, response)
        # Surface the test run's trace_id so the playground UI can render it
        # in the live trace pane (same code path as the chat endpoint).
        trace_id = _extract_trace_id(raw)

        new_status = issue.status
        if verdict.passed and issue.status != IssueStatus.DONE:
            # Transition through review if the issue was still in_progress;
            # the state-machine guard requires that hop. todo issues skip
            # straight via in_progress → review → done.
            for target in (
                IssueStatus.IN_PROGRESS,
                IssueStatus.REVIEW,
                IssueStatus.DONE,
            ):
                if issue.status == target:
                    continue
                try:
                    issue = await asyncio.to_thread(store.transition_issue, issue_id, target, "")
                except MlflowException:
                    # Skip illegal hops silently — happens when issue.status
                    # is already past the target.
                    pass
            new_status = issue.status

        return {
            "passed": verdict.passed,
            "reasons": list(verdict.reasons),
            "strategy": verdict.strategy,
            "judge_reasoning": verdict.judge_reasoning,
            "issue_status": new_status.value if hasattr(new_status, "value") else str(new_status),
            "agent_response_text": response.text,
            "agent_tool_calls": response.tool_calls,
            "trace_id": trace_id,
        }

    @router.patch("/regression-suite/cases/{test_case_id}")
    async def update_regression_case(test_case_id: str, request: dict[str, Any]) -> dict[str, Any]:
        """Edit one test case in place. Body shape::

            {
              "experiment_id": "...",
              "question": "<new user message>",     # optional
              "assertion": { must_contain, must_not_contain,
                              must_call_tool, must_not_call_tool },  # optional
              "judge": { "criteria": "...", "expected_response": "..." }  # optional
            }

        Omitted fields keep their current values. Supplying ``assertion``
        flips the strategy to "assertion" (and clears any judge spec);
        supplying ``judge`` does the inverse. Both at once is rejected.
        """
        experiment_id = request.get("experiment_id")
        question = request.get("question")
        assertion = request.get("assertion")
        judge = request.get("judge")

        if not isinstance(experiment_id, str) or not experiment_id:
            raise HTTPException(
                status_code=400, detail="`experiment_id` must be a non-empty string."
            )
        if question is not None and not isinstance(question, str):
            raise HTTPException(
                status_code=400, detail="`question` must be a string when provided."
            )
        if assertion is not None and not isinstance(assertion, dict):
            raise HTTPException(
                status_code=400, detail="`assertion` must be an object when provided."
            )
        if judge is not None and not isinstance(judge, dict):
            raise HTTPException(status_code=400, detail="`judge` must be an object when provided.")
        if assertion is not None and judge is not None:
            raise HTTPException(
                status_code=400,
                detail="Pass either `assertion` or `judge`, not both.",
            )

        from mlflow.playground.regression_suite import update_test_case

        try:
            await asyncio.to_thread(
                update_test_case,
                experiment_id,
                test_case_id,
                question=question,
                assertion=assertion,
                judge=judge,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return {"updated": test_case_id}

    @router.delete("/regression-suite/cases/{test_case_id}")
    async def delete_regression_case(test_case_id: str, experiment_id: str) -> dict[str, Any]:
        """Remove one test case from the regression suite. Idempotent — a
        double-click in the UI shouldn't 404.
        """
        from mlflow.playground.regression_suite import delete_test_case

        try:
            await asyncio.to_thread(delete_test_case, experiment_id, test_case_id)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        return {"deleted": test_case_id}

    @router.get("/regression-suite/run-grouped/stream")
    async def run_regression_suite_grouped_stream(experiment_id: str) -> StreamingResponse:
        """Run the entire regression suite, grouping cases by their input
        conversation prefix so the agent is invoked once per unique question
        rather than once per case.

        Why grouping matters: a single Issue often spawns multiple test
        cases (one per dispatched feedback) that all anchor to the same
        failing turn. Hitting the agent N times with the same prompt
        wastes tokens / time when one invocation produces a response that
        every spec can be evaluated against.

        Stream events (each is one ``data: <json>\\n\\n`` line):

          * ``{type: "run_started", run_id}`` — parent MLflow Run created;
            client uses this to link the in-flight UI to the persisted run.
          * ``{type: "started", total_groups, total_cases}``
          * ``{type: "group_started", group_index, label, case_count, messages}``
          * ``{type: "group_verdict", group_index, agent_response_text,``
            ``agent_tool_calls, verdicts: [...]}`` — each verdict is
            ``{test_case_id, issue_id, rationale_summary, passed, reasons, strategy}``.
          * ``{type: "group_error", group_index, detail}`` — the group's
            agent invocation failed; following groups still run.
          * ``{type: "summary", total_groups, run_id}`` — terminator; carries
            the run id again so a late-binding client can still pick it up.

        Persistence: the entire run is wrapped in an MLflow Run tagged with
        ``playground.run_kind = "regression_suite"`` and a JSON artifact
        ``regression_run.json`` carrying the full conversations + verdicts
        snapshot. Recent-runs UI reads this back to rehydrate the navigator.
        """
        import json as _json
        import time as _time

        import mlflow as _mlflow
        from mlflow.playground.regression_suite import (
            get_or_create_regression_dataset,
            regression_dataset_name,
        )
        from mlflow.playground.test_runner import evaluate, normalize_agent_response

        async def _events():
            def _emit(payload: dict[str, Any]) -> str:
                return f"data: {_json.dumps(payload)}\n\n"

            # Reuse the same coercion the cockpit cases endpoint uses — the
            # dataset backend may round-trip `inputs` and nested `messages`
            # as JSON-encoded strings rather than parsed dicts.
            def _coerce(v: Any) -> Any:
                if isinstance(v, str):
                    try:
                        return _json.loads(v)
                    except (ValueError, TypeError):
                        return v
                return v

            # Create the parent MLflow Run upfront so the client knows the
            # run_id from the very first event. Materialise it via a
            # context-manager `start_run` that auto-ends; we then re-enter
            # later with `start_run(run_id=...)` to log metrics + artifact
            # once the work completes. Avoids leaving a zombie active run if
            # the SSE client disconnects mid-stream.
            #
            # Pushed into a thread because `start_run` is a synchronous HTTP
            # call against the configured tracking URI — leaving it on the
            # event loop would freeze the SSE stream while the round-trip
            # completes (visible to the user as a stuck 0/0 indicator).
            started_at = _time.time()

            def _create_parent_run() -> str:
                with _mlflow.start_run(
                    experiment_id=experiment_id,
                    run_name=f"regression run @ {_time.strftime('%H:%M:%S')}",
                    tags={
                        "playground.run_kind": "regression_suite",
                        "playground.regression_dataset": regression_dataset_name(experiment_id),
                    },
                ) as parent_run:
                    return parent_run.info.run_id

            try:
                parent_run_id = await asyncio.to_thread(_create_parent_run)
            except Exception as exc:
                # `group_index: -1` flags this as a run-level error (no
                # group slot to attach it to). The client surfaces it as a
                # toast and aborts the batch.
                yield _emit({
                    "type": "run_error",
                    "detail": f"Could not create MLflow run: {exc}",
                })
                return

            yield _emit({"type": "run_started", "run_id": parent_run_id})

            try:
                dataset = await asyncio.to_thread(get_or_create_regression_dataset, experiment_id)
                df = await asyncio.to_thread(dataset.to_df)
            except Exception as exc:
                yield _emit({
                    "type": "run_error",
                    "detail": f"Could not load regression dataset: {exc}",
                })
                return

            rows = df.to_dict(orient="records") if not df.empty else []
            # Group by the conversation prefix — JSON-stringify with sorted
            # keys so dict ordering can't accidentally split a group.
            groups: dict[str, list[dict[str, Any]]] = {}
            for row in rows:
                inputs = _coerce(row.get("inputs") or {})
                if not isinstance(inputs, dict):
                    continue
                messages = _coerce(inputs.get("messages") or [])
                if not isinstance(messages, list):
                    continue
                key = _json.dumps(messages, sort_keys=True)
                groups.setdefault(key, []).append(row)

            groups_list = list(groups.items())
            total_cases = sum(len(g) for _, g in groups_list)
            yield _emit({
                "type": "started",
                "total_groups": len(groups_list),
                "total_cases": total_cases,
            })

            # `snapshot_slots[gi]` mirrors the in-memory `BatchConversation`
            # shape on the client; we write the whole list as a JSON
            # artifact when the run finishes so the playground can rehydrate
            # the navigator from it later. Pre-allocated by group_index so
            # the parallel run_one tasks can mutate independent slots without
            # locking.
            snapshot_slots: list[dict[str, Any]] = []

            # Emit all `group_started` events sequentially in deterministic
            # order so the navigator slot list is stable. The actual agent
            # invocations + spec evaluation happen below in parallel; their
            # `group_verdict` events stream back in completion order, which
            # is the user's observable proxy for "how fast each group ran."
            group_specs: list[tuple[int, list[Any], list[dict[str, Any]]]] = []
            for gi, (key, group_rows) in enumerate(groups_list):
                messages = _json.loads(key)
                # Pick the first non-empty rationale_summary as the group label;
                # fall back to the last user content; finally to a generic stub.
                label = ""
                for row in group_rows:
                    expectations = _coerce(row.get("expectations") or {})
                    if isinstance(expectations, dict):
                        candidate = expectations.get("rationale_summary")
                        if isinstance(candidate, str) and candidate:
                            label = candidate
                            break
                if not label:
                    for msg in reversed(messages):
                        if isinstance(msg, dict) and msg.get("role") == "user":
                            content = msg.get("content")
                            if isinstance(content, str):
                                label = content
                                break
                if not label:
                    label = f"group {gi + 1}"

                yield _emit({
                    "type": "group_started",
                    "group_index": gi,
                    "total_groups": len(groups_list),
                    "label": label,
                    "case_count": len(group_rows),
                    "messages": messages,
                })
                group_specs.append((gi, messages, group_rows))
                snapshot_slots.append({
                    "row_id": f"group-{gi}",
                    "label": label,
                    "messages": list(messages),
                    "status": "pending",
                    "verdicts": [],
                })

            # Bound the parallelism — local agents are usually single-process
            # / single-port HTTP and stacking too many concurrent invocations
            # against them will saturate the listener. 8 is a pragmatic
            # default that handles typical 10-40 case suites without
            # crushing a vanilla `mlflow agent playground` subprocess.
            _REGRESSION_PARALLELISM = 8
            sem = asyncio.Semaphore(_REGRESSION_PARALLELISM)

            queue: asyncio.Queue[Any] = asyncio.Queue()
            sentinel = object()

            async def run_one(gi: int, messages: list[Any], group_rows: list[dict[str, Any]]):
                async with sem:
                    # Tag the agent's trace with a per-group request_id so we
                    # can look it up by tag below — non-ResponsesAgent agents
                    # don't include `metadata.trace_id` in their response, so
                    # `_extract_trace_id(raw)` returns None for the typical
                    # plain `@invoke()` agent. The tag is the universal escape
                    # hatch (same pattern the chat handler uses).
                    import uuid as _uuid
                    group_request_id = f"reg-{parent_run_id}-{gi}-{_uuid.uuid4().hex[:8]}"
                    try:
                        raw, _protocol = await _invoke_agent(
                            agent_url=_active_agent_url(),
                            messages=messages,
                            timeout_seconds=120.0,
                            request_id=group_request_id,
                        )
                    except Exception as exc:
                        snapshot_slots[gi]["status"] = "failed"
                        snapshot_slots[gi]["error"] = f"Agent invocation failed: {exc}"
                        await queue.put(_emit({
                            "type": "group_error",
                            "group_index": gi,
                            "detail": f"Agent invocation failed: {exc}",
                        }))
                        return

                    response = normalize_agent_response(raw)

                    verdicts: list[dict[str, Any]] = []
                    for row in group_rows:
                        expectations = _coerce(row.get("expectations") or {})
                        spec = (
                            expectations.get("test_spec") if isinstance(expectations, dict) else {}
                        )
                        if not isinstance(spec, dict):
                            spec = {}
                        tags = _coerce(row.get("tags") or {})
                        if not isinstance(tags, dict):
                            tags = {}
                        test_case_id = (
                            expectations.get("test_case_id")
                            if isinstance(expectations, dict)
                            else None
                        )
                        rationale_summary = (
                            expectations.get("rationale_summary")
                            if isinstance(expectations, dict)
                            else None
                        )
                        try:
                            v = await asyncio.to_thread(evaluate, spec, response)
                            verdicts.append({
                                "test_case_id": test_case_id,
                                "issue_id": tags.get("issue_id"),
                                "rationale_summary": rationale_summary,
                                "passed": v.passed,
                                "reasons": list(v.reasons),
                                "strategy": v.strategy,
                            })
                        except Exception as exc:
                            verdicts.append({
                                "test_case_id": test_case_id,
                                "issue_id": tags.get("issue_id"),
                                "passed": False,
                                "reasons": [f"Evaluator error: {exc}"],
                                "strategy": "error",
                            })

                    trace_id = _extract_trace_id(raw)
                    if not trace_id:
                        # Fallback for non-ResponsesAgent: the agent server only
                        # adds `metadata.trace_id` to the response when the
                        # agent_type is "ResponsesAgent" (see
                        # `mlflow/genai/agent_server/server.py:390-395`). For
                        # plain `@invoke()` agents, look the trace up by the
                        # request_id tag we just set above.
                        trace_id = await asyncio.to_thread(
                            _lookup_trace_id_by_request_id,
                            experiment_id,
                            group_request_id,
                        )
                    snapshot_slots[gi]["status"] = "done"
                    snapshot_slots[gi]["messages"] = [
                        *snapshot_slots[gi]["messages"],
                        {"role": "assistant", "content": response.text or ""},
                    ]
                    snapshot_slots[gi]["verdicts"] = verdicts
                    if trace_id:
                        snapshot_slots[gi]["trace_id"] = trace_id

                    await queue.put(_emit({
                        "type": "group_verdict",
                        "group_index": gi,
                        "agent_response_text": response.text,
                        "agent_tool_calls": response.tool_calls,
                        "verdicts": verdicts,
                        # Trace produced by this group's agent invocation, so the
                        # playground can advance the Live Trace pane in lock-step
                        # with the "Question m/N" navigator.
                        "trace_id": trace_id,
                    }))

            tasks = [
                asyncio.create_task(run_one(gi, messages, group_rows))
                for gi, messages, group_rows in group_specs
            ]

            async def _drain_when_done():
                try:
                    await asyncio.gather(*tasks, return_exceptions=True)
                finally:
                    await queue.put(sentinel)

            drainer = asyncio.create_task(_drain_when_done())

            try:
                while True:
                    event = await queue.get()
                    if event is sentinel:
                        break
                    yield event
            finally:
                # Make sure the drainer is awaited even if the client
                # disconnects mid-stream, so we don't leave orphaned tasks.
                await drainer

            # Finalise the parent run — log summary metrics + the JSON
            # snapshot artifact. `start_run(run_id=...)` re-enters the run
            # we created earlier; the context manager auto-ends it. Done in
            # a worker thread to avoid blocking the SSE generator (sqlite
            # writes + artifact upload).
            ended_at = _time.time()
            pass_count = sum(
                1 for s in snapshot_slots for v in s.get("verdicts", []) if v.get("passed")
            )
            fail_count = sum(
                1 for s in snapshot_slots for v in s.get("verdicts", []) if not v.get("passed")
            )
            total_count = pass_count + fail_count
            pass_rate = (pass_count / total_count) if total_count > 0 else 0.0

            snapshot = {
                "kind": "regression_suite",
                "run_id": parent_run_id,
                "experiment_id": experiment_id,
                "started_at_ms": int(started_at * 1000),
                "ended_at_ms": int(ended_at * 1000),
                "summary": {
                    "pass_count": pass_count,
                    "fail_count": fail_count,
                    "total_count": total_count,
                    "pass_rate": pass_rate,
                },
                "conversations": snapshot_slots,
            }

            def _finalise() -> None:
                with _mlflow.start_run(run_id=parent_run_id):
                    _mlflow.log_metric("pass_count", pass_count)
                    _mlflow.log_metric("fail_count", fail_count)
                    _mlflow.log_metric("pass_rate", pass_rate)
                    _mlflow.log_metric("total_duration_ms", int((ended_at - started_at) * 1000))
                    _mlflow.log_dict(snapshot, "regression_run.json")

            try:
                await asyncio.to_thread(_finalise)
            except Exception:
                # Don't fail the SSE response if the artifact write tripped —
                # the user already saw the verdicts, and the recent-runs row
                # will simply not be rehydratable. Log nothing here; the
                # playground server's stderr will show MLflow's own message.
                pass

            yield _emit({
                "type": "summary",
                "total_groups": len(groups_list),
                "run_id": parent_run_id,
            })

        return StreamingResponse(_events(), media_type="text/event-stream")

    @router.get("/regression-suite/runs")
    async def list_regression_runs(experiment_id: str, limit: int = 10) -> dict[str, Any]:
        """Recent regression-suite runs for the given experiment, newest
        first. Backed by `MlflowClient.search_runs` filtered by the
        `playground.run_kind` tag, so this list is the authoritative
        cross-session record.
        """
        from mlflow.tracking.client import MlflowClient

        try:
            client = MlflowClient()
            runs = await asyncio.to_thread(
                client.search_runs,
                experiment_ids=[experiment_id],
                filter_string='tags."playground.run_kind" = "regression_suite"',
                order_by=["attributes.start_time DESC"],
                max_results=max(1, min(limit, 50)),
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        out: list[dict[str, Any]] = []
        for r in runs:
            metrics = r.data.metrics or {}
            tags = r.data.tags or {}
            pass_count = int(metrics.get("pass_count", 0))
            fail_count = int(metrics.get("fail_count", 0))
            out.append({
                "run_id": r.info.run_id,
                "started_at": r.info.start_time,
                "ended_at": r.info.end_time,
                "pass_count": pass_count,
                "fail_count": fail_count,
                "total_count": pass_count + fail_count,
                "pass_rate": float(metrics.get("pass_rate", 0.0)),
                "agent_git_sha": tags.get("playground.agent_git_sha", ""),
            })
        return {"runs": out}

    @router.get("/regression-suite/runs/{run_id}/snapshot")
    async def get_regression_run_snapshot(run_id: str, experiment_id: str) -> dict[str, Any]:
        """Fetch the `regression_run.json` artifact for a finished
        regression-suite run. Lets the cockpit rehydrate the navigator
        + verdict banners exactly as they were when the run completed.
        """
        import json as _json
        import tempfile as _tempfile

        from mlflow.tracking.client import MlflowClient

        # `experiment_id` arrives via query string for symmetry with the
        # other regression-suite endpoints; not actually used here because
        # MLflow's artifact API resolves by run_id alone, but keeping it in
        # the URL means the client can stay generic over the experiment.
        del experiment_id

        client = MlflowClient()
        try:
            with _tempfile.TemporaryDirectory() as tmpdir:
                local = await asyncio.to_thread(
                    client.download_artifacts, run_id, "regression_run.json", tmpdir
                )
                with open(local) as f:
                    return _json.load(f)
        except FileNotFoundError as exc:
            raise HTTPException(
                status_code=404,
                detail=f"No regression_run.json artifact on run {run_id!r}.",
            ) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    @router.get("/issues/{issue_id}/run-test/stream")
    async def run_test_stream(issue_id: str) -> StreamingResponse:
        """Streaming variant of ``run_test`` — emits stage-level progress events
        so the cockpit can show the user what the runner is doing instead of a
        bare spinner. Same logic flow as the POST endpoint:

            loading → replaying → evaluating → verdict

        Each event is a single ``data: <json>\\n\\n`` line. The JSON ``type``
        field is one of ``"progress"``, ``"verdict"``, or ``"error"`` — the
        client dispatches on it. We deliberately do not use the SSE ``event:``
        field for parity with the chat endpoint and to keep the parser simple.
        """
        import json as _json

        from mlflow.entities.issue import IssueStatus
        from mlflow.exceptions import MlflowException
        from mlflow.playground.regression_suite import get_or_create_regression_dataset
        from mlflow.playground.test_runner import evaluate, normalize_agent_response
        from mlflow.tracking._tracking_service.utils import _get_store

        async def _events():
            def _emit(payload: dict[str, Any]) -> str:
                return f"data: {_json.dumps(payload)}\n\n"

            def _progress(stage: str, message: str) -> str:
                return _emit({"type": "progress", "stage": stage, "message": message})

            def _error(stage: str, detail: str) -> str:
                return _emit({"type": "error", "stage": stage, "detail": detail})

            # --- 1. Loading test case ---------------------------------------
            yield _progress("loading", "Loading test case…")

            store = _get_store()
            try:
                issue = await asyncio.to_thread(store.get_issue, issue_id)
            except MlflowException as exc:
                yield _error("loading", str(exc))
                return

            if issue.status in (IssueStatus.PENDING, IssueStatus.RESOLVED):
                yield _error(
                    "loading",
                    "Legacy detection-path issues aren't runnable through the "
                    "playground; use the discovery flow instead.",
                )
                return

            try:
                dataset = await asyncio.to_thread(
                    get_or_create_regression_dataset, str(issue.experiment_id)
                )
                df = await asyncio.to_thread(dataset.to_df)
            except Exception as exc:
                yield _error("loading", f"Could not load regression dataset: {exc}")
                return

            rows = df.to_dict(orient="records") if not df.empty else []
            match = None
            for row in rows:
                expectations = row.get("expectations") or {}
                if issue.test_case_id and expectations.get("test_case_id") == issue.test_case_id:
                    match = row
                    break
                tags = row.get("tags") or {}
                if tags.get("issue_id") == issue_id:
                    match = row
                    break
            if match is None:
                yield _error(
                    "loading",
                    f"No regression-suite row found for issue {issue_id!r}. "
                    "Has the test case been generated yet?",
                )
                return

            expectations = match.get("expectations") or {}
            spec = expectations.get("test_spec") or {}
            messages = (match.get("inputs") or {}).get("messages")
            if not isinstance(messages, list) or not isinstance(spec, dict):
                yield _error(
                    "loading",
                    "Regression-suite row is malformed (missing inputs.messages or test_spec).",
                )
                return

            # --- 2. Replaying conversation ----------------------------------
            yield _progress("replaying", "Replaying conversation against the agent…")

            try:
                raw, _protocol = await _invoke_agent(
                    agent_url=_active_agent_url(),
                    messages=messages,
                    timeout_seconds=120.0,
                )
            except Exception as exc:
                yield _error("replaying", f"Agent invocation failed: {exc}")
                return

            response = normalize_agent_response(raw)

            # --- 3. Evaluating assertions -----------------------------------
            yield _progress("evaluating", "Evaluating assertions…")

            try:
                verdict = await asyncio.to_thread(evaluate, spec, response)
            except Exception as exc:
                yield _error("evaluating", f"Evaluator raised: {exc}")
                return

            new_status = issue.status
            if verdict.passed and issue.status != IssueStatus.DONE:
                # Mirror run_test's transition path: in_progress → review → done,
                # skipping hops that fail (issue may already be past a stage).
                for target in (
                    IssueStatus.IN_PROGRESS,
                    IssueStatus.REVIEW,
                    IssueStatus.DONE,
                ):
                    if issue.status == target:
                        continue
                    try:
                        issue = await asyncio.to_thread(
                            store.transition_issue, issue_id, target, ""
                        )
                    except MlflowException:
                        pass
                new_status = issue.status

            # --- 4. Verdict --------------------------------------------------
            issue_status = new_status.value if hasattr(new_status, "value") else str(new_status)
            yield _emit({
                "type": "verdict",
                "passed": verdict.passed,
                "reasons": list(verdict.reasons),
                "strategy": verdict.strategy,
                "judge_reasoning": verdict.judge_reasoning,
                "issue_status": issue_status,
                "agent_response_text": response.text,
                "agent_tool_calls": response.tool_calls,
                # Surface the test run's trace_id so the playground UI can
                # render it in the live trace pane (same as the chat path).
                "trace_id": _extract_trace_id(raw),
            })

        return StreamingResponse(_events(), media_type="text/event-stream")

    @router.post("/issues/dispatch")
    async def dispatch_issue(request: dict[str, Any]) -> dict[str, Any]:
        rationale = request.get("rationale")
        failing = request.get("failing_assistant_message")
        prefix = request.get("conversation_prefix")

        if not isinstance(rationale, str) or not rationale.strip():
            raise HTTPException(status_code=400, detail="`rationale` must be a non-empty string.")
        if not isinstance(failing, str) or not failing.strip():
            raise HTTPException(
                status_code=400,
                detail="`failing_assistant_message` must be a non-empty string.",
            )
        if not isinstance(prefix, list):
            raise HTTPException(status_code=400, detail="`conversation_prefix` must be a list.")

        try:
            return await asyncio.to_thread(
                _dispatch_feedback,
                runtime.config_path,
                rationale=rationale,
                failing_assistant_message=failing,
                conversation_prefix=prefix,
                expected_response=request.get("expected_response"),
                aspect=request.get("aspect"),
                experiment_id=request.get("experiment_id"),
                source_trace_id=request.get("source_trace_id"),
                source_feedback_id=request.get("source_feedback_id"),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Dispatch failed: {exc}") from exc

    # ----- Agent connection registry (Epic 8 / YUK-47) -----------------------

    @router.post("/agent-connections/register")
    async def register_connection(request: dict[str, Any]) -> dict[str, Any]:
        """Self-registration entry point for agents (workers + manual attaches).

        The launched `main` agent is auto-registered at router construction;
        workers register here via the `mlflow agent connect` CLI (YUK-48).
        """
        name = request.get("name")
        agent_url_in = request.get("agent_url")
        if not isinstance(name, str) or not name.strip():
            raise HTTPException(status_code=400, detail="`name` is required.")
        if not isinstance(agent_url_in, str) or not agent_url_in.strip():
            raise HTTPException(status_code=400, detail="`agent_url` is required.")
        repo_dir_in = request.get("repo_dir")
        status_in = request.get("status") or "ready"
        if status_in not in {"pending", "ready", "failed"}:
            raise HTTPException(
                status_code=400,
                detail=f"`status` must be one of pending|ready|failed, got {status_in!r}.",
            )
        connection = AgentConnection(
            connection_id=_new_connection_id(),
            name=name.strip(),
            agent_url=_normalize_agent_url(agent_url_in),
            repo_dir=Path(repo_dir_in) if isinstance(repo_dir_in, str) and repo_dir_in else None,
            source_issue_id=request.get("source_issue_id"),
            branch=request.get("branch"),
            base_commit=request.get("base_commit"),
            status=status_in,
            status_message=request.get("status_message"),
            created_at_ms=int(time.time() * 1000),
        )
        with runtime.connections_lock:
            runtime.connections[connection.connection_id] = connection
        return connection.to_dict()

    @router.get("/agent-connections")
    async def list_connections() -> dict[str, Any]:
        with runtime.connections_lock:
            connections = [c.to_dict() for c in runtime.connections.values()]
            active_id = runtime.active_connection_id
        return {"connections": connections, "active_connection_id": active_id}

    @router.get("/agent-connections/{connection_id}")
    async def get_connection(connection_id: str) -> dict[str, Any]:
        with runtime.connections_lock:
            connection = runtime.connections.get(connection_id)
        if connection is None:
            raise HTTPException(status_code=404, detail=f"Connection {connection_id} not found.")
        return connection.to_dict()

    @router.delete("/agent-connections/{connection_id}")
    async def deregister_connection(connection_id: str) -> dict[str, Any]:
        with runtime.connections_lock:
            connection = runtime.connections.pop(connection_id, None)
            if runtime.active_connection_id == connection_id:
                # If the active connection vanishes, fall back to main if it
                # still exists; otherwise leave active unset.
                runtime.active_connection_id = next(
                    (c.connection_id for c in runtime.connections.values() if c.name == "main"),
                    None,
                )
        if connection is None:
            raise HTTPException(status_code=404, detail=f"Connection {connection_id} not found.")
        return connection.to_dict()

    @router.post("/agent-connections/{connection_id}/activate")
    async def activate_connection(connection_id: str) -> dict[str, Any]:
        with runtime.connections_lock:
            connection = runtime.connections.get(connection_id)
            if connection is None:
                raise HTTPException(
                    status_code=404, detail=f"Connection {connection_id} not found."
                )
            if connection.status not in {"ready", "pending"}:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Connection {connection_id} is in status {connection.status!r}; "
                        "only ready or pending connections can be activated."
                    ),
                )
            runtime.active_connection_id = connection_id
            return connection.to_dict()

    # ----- Worker dispatch (Epic 8 / YUK-50) ---------------------------------

    @router.post("/issues/{issue_id}/dispatch-worker")
    async def dispatch_worker(issue_id: str) -> dict[str, Any]:
        """Reserve an Issue for a worker: create the worktree + register a
        pending placeholder connection + transition issue todo→in_progress.

        The actual Claude dispatch (YUK-51) is a separate background step
        that finalises the connection by calling ``mlflow agent connect``
        once the fix is committed.
        """
        from mlflow.entities.issue import IssueStatus
        from mlflow.exceptions import MlflowException
        from mlflow.playground.worker import (
            WorkerWorktree,
            create_worker_worktree,
            prune_worker_worktree,
        )
        from mlflow.tracking._tracking_service.utils import _get_store

        if runtime.repo_dir is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Playground was not launched against an agent repo, so there's "
                    "nowhere to put a worker worktree. Restart with `mlflow agent "
                    "playground` from your agent repo."
                ),
            )

        # Refuse concurrent dispatch.
        with runtime.connections_lock:
            existing = next(
                (
                    c
                    for c in runtime.connections.values()
                    if c.source_issue_id == issue_id and c.status in {"pending", "ready"}
                ),
                None,
            )
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Issue {issue_id} already has an active worker "
                    f"(connection_id={existing.connection_id}, status={existing.status}). "
                    "Discard or accept it before dispatching a new one."
                ),
            )

        store = _get_store()
        try:
            issue = await asyncio.to_thread(store.get_issue, issue_id)
        except MlflowException as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

        if issue.status != IssueStatus.TODO:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Issue {issue_id} is in status {issue.status.value!r}; only "
                    "issues in `todo` can be dispatched. Move it back to todo or "
                    "use the manual fix flow."
                ),
            )

        try:
            worktree: WorkerWorktree = await asyncio.to_thread(
                create_worker_worktree, runtime.repo_dir, issue_id
            )
        except FileExistsError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except subprocess.CalledProcessError as exc:
            raise HTTPException(status_code=500, detail=f"git worktree add failed: {exc}") from exc

        connection = AgentConnection(
            connection_id=_new_connection_id(),
            name=f"fix-{issue_id}-1",
            agent_url="",  # Filled in once the worker boots its agent (YUK-51).
            repo_dir=worktree.worktree_path,
            source_issue_id=issue_id,
            branch=worktree.branch,
            base_commit=worktree.base_commit,
            status="pending",
            status_message="Waiting for worker to bring the agent up.",
            created_at_ms=int(time.time() * 1000),
            log_path=worktree.worktree_path / ".mlflow" / "claude.log",
        )
        with runtime.connections_lock:
            runtime.connections[connection.connection_id] = connection

        try:
            await asyncio.to_thread(
                store.transition_issue,
                issue_id,
                IssueStatus.IN_PROGRESS,
                connection.connection_id,
            )
        except MlflowException as exc:
            # Roll back: drop the connection + worktree.
            with runtime.connections_lock:
                runtime.connections.pop(connection.connection_id, None)
            await asyncio.to_thread(prune_worker_worktree, runtime.repo_dir, issue_id, force=True)
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        return {
            "connection_id": connection.connection_id,
            "worktree_path": str(worktree.worktree_path),
            "branch": worktree.branch,
            "base_commit": worktree.base_commit,
            "base_branch": worktree.base_branch,
        }

    return router
