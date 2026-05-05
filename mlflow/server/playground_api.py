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
    _dispatch_feedback,
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
            if (
                issue.test_case_id
                and expectations.get("test_case_id") == issue.test_case_id
            ):
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
            if (
                issue.test_case_id
                and expectations.get("test_case_id") == issue.test_case_id
            ):
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
                agent_url=runtime.agent_url,
                messages=messages,
                timeout_seconds=120.0,
            )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=502, detail=f"Agent invocation failed: {exc}"
            ) from exc

        response = normalize_agent_response(raw)
        verdict = await asyncio.to_thread(evaluate, spec, response)

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
                    issue = await asyncio.to_thread(
                        store.transition_issue, issue_id, target, ""
                    )
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
        }

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
                if (
                    issue.test_case_id
                    and expectations.get("test_case_id") == issue.test_case_id
                ):
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
                    agent_url=runtime.agent_url,
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
            issue_status = (
                new_status.value if hasattr(new_status, "value") else str(new_status)
            )
            yield _emit({
                "type": "verdict",
                "passed": verdict.passed,
                "reasons": list(verdict.reasons),
                "strategy": verdict.strategy,
                "judge_reasoning": verdict.judge_reasoning,
                "issue_status": issue_status,
                "agent_response_text": response.text,
                "agent_tool_calls": response.tool_calls,
            })

        return StreamingResponse(_events(), media_type="text/event-stream")

    @router.post("/issues/dispatch")
    async def dispatch_issue(request: dict[str, Any]) -> dict[str, Any]:
        rationale = request.get("rationale")
        failing = request.get("failing_assistant_message")
        prefix = request.get("conversation_prefix")

        if not isinstance(rationale, str) or not rationale.strip():
            raise HTTPException(
                status_code=400, detail="`rationale` must be a non-empty string."
            )
        if not isinstance(failing, str) or not failing.strip():
            raise HTTPException(
                status_code=400,
                detail="`failing_assistant_message` must be a non-empty string.",
            )
        if not isinstance(prefix, list):
            raise HTTPException(
                status_code=400, detail="`conversation_prefix` must be a list."
            )

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
            raise HTTPException(
                status_code=500, detail=f"Dispatch failed: {exc}"
            ) from exc

    return router
