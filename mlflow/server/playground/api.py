import logging
import shutil
from collections.abc import AsyncGenerator
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

logger = logging.getLogger(__name__)
from starlette.responses import StreamingResponse

from mlflow.assistant.types import EventType
from mlflow.server.assistant.api import _require_localhost
from mlflow.server.playground.execution import MODEL_MAP, stream_panel_execution
from mlflow.server.playground.models import (
    CancelPanelResponse,
    CommitInfo,
    CreateSessionRequest,
    ListCommitsResponse,
    ListSkillsResponse,
    RunPanelRequest,
    RunPanelResponse,
    SessionResponse,
    SkillInfo,
    UpdatePanelConfigRequest,
)
from mlflow.server.playground.repo_cache import is_remote_url, resolve_repo
from mlflow.server.playground.session import (
    PlaygroundSessionManager,
    terminate_panel_process,
)
from mlflow.server.playground.skill_checkout import (
    checkout_skills_from_commit,
    checkout_skills_from_working_tree,
    list_recent_commits,
    list_skills_at_ref,
)

playground_router = APIRouter(
    prefix="/ajax-api/3.0/mlflow/playground",
    tags=["playground"],
    dependencies=[Depends(_require_localhost)],
)


@playground_router.post("/sessions", response_model=SessionResponse)
async def create_session(request: CreateSessionRequest) -> SessionResponse:
    session_id, session = PlaygroundSessionManager.create(request.experiment_id)
    return SessionResponse(
        session_id=session.session_id,
        experiment_id=session.experiment_id,
        created_at=session.created_at,
        config_a=session.config_a,
        config_b=session.config_b,
    )


@playground_router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str) -> SessionResponse:
    session = PlaygroundSessionManager.load(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionResponse(
        session_id=session.session_id,
        experiment_id=session.experiment_id,
        created_at=session.created_at,
        config_a=session.config_a,
        config_b=session.config_b,
    )


@playground_router.delete("/sessions/{session_id}")
async def delete_session(session_id: str) -> dict[str, str]:
    session = PlaygroundSessionManager.load(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    PlaygroundSessionManager.delete(session_id)
    return {"status": "deleted"}


@playground_router.put(
    "/sessions/{session_id}/panels/{panel_id}/config",
    response_model=SessionResponse,
)
async def update_panel_config(
    session_id: str,
    panel_id: Literal["a", "b"],
    request: UpdatePanelConfigRequest,
) -> SessionResponse:
    session = PlaygroundSessionManager.load(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    panel = session.config_a if panel_id == "a" else session.config_b

    # Merge only provided fields
    if request.skills is not None:
        panel.skills = request.skills
    if request.allowed_tools is not None:
        panel.allowed_tools = request.allowed_tools
    if request.model is not None:
        panel.model = request.model

    # Re-checkout skills into workspace
    workspace = PlaygroundSessionManager.get_workspace_dir(session_id)
    skills_dest = workspace / f"panel-{panel_id}" / ".claude" / "skills"

    # Clear existing skills
    if skills_dest.exists():
        shutil.rmtree(skills_dest)
    skills_dest.mkdir(parents=True, exist_ok=True)

    # Checkout each skill entry ("*" means all skills from the repo)
    for skill_entry in panel.skills:
        if is_remote_url(skill_entry.repo) and skill_entry.commit_id == "working-tree":
            detail = f"Cannot use 'working-tree' with remote repo '{skill_entry.repo}'"
            logger.error("update_panel_config: %s", detail)
            raise HTTPException(status_code=400, detail=detail)
        try:
            repo = resolve_repo(skill_entry.repo)
        except ValueError as e:
            logger.error("update_panel_config: resolve_repo failed for '%s': %s", skill_entry.repo, e)
            raise HTTPException(status_code=400, detail=str(e))
        skill_names = None if skill_entry.name == "*" else [skill_entry.name]
        try:
            if skill_entry.commit_id == "working-tree":
                checkout_skills_from_working_tree(
                    repo, skills_dest, skill_names=skill_names
                )
            else:
                checkout_skills_from_commit(
                    repo, skill_entry.commit_id, skills_dest, skill_names=skill_names
                )
        except ValueError as e:
            logger.error(
                "update_panel_config: skill checkout failed for '%s' at '%s': %s",
                skill_entry.name, skill_entry.commit_id, e,
            )
            raise HTTPException(status_code=400, detail=str(e))

    PlaygroundSessionManager.save(session_id, session)

    return SessionResponse(
        session_id=session.session_id,
        experiment_id=session.experiment_id,
        created_at=session.created_at,
        config_a=session.config_a,
        config_b=session.config_b,
    )


@playground_router.get("/skills/list", response_model=ListSkillsResponse)
async def list_skills(
    repo: str = Query(..., description="Local path or remote git URL"),
    ref: str = Query(..., description="Commit hash or 'working-tree'"),
) -> ListSkillsResponse:
    if is_remote_url(repo) and ref == "working-tree":
        detail = f"Cannot use 'working-tree' with remote repo '{repo}'"
        logger.error("list_skills: %s", detail)
        raise HTTPException(status_code=400, detail=detail)
    try:
        resolved = resolve_repo(repo)
    except ValueError as e:
        logger.error("list_skills: resolve_repo failed for '%s': %s", repo, e)
        raise HTTPException(status_code=400, detail=str(e))
    try:
        skills = list_skills_at_ref(resolved, ref)
    except ValueError as e:
        logger.error("list_skills: list_skills_at_ref failed for '%s' at '%s': %s", repo, ref, e)
        raise HTTPException(status_code=400, detail=str(e))
    return ListSkillsResponse(skills=[SkillInfo(name=s) for s in skills])


@playground_router.get("/skills/commits", response_model=ListCommitsResponse)
async def list_commits(
    repo: str = Query(..., description="Local path or remote git URL"),
    count: int = Query(20, description="Number of recent commits to return"),
) -> ListCommitsResponse:
    try:
        resolved = resolve_repo(repo)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        commits = list_recent_commits(resolved, count=count)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return ListCommitsResponse(
        commits=[CommitInfo(hash=c["hash"], message=c["message"]) for c in commits]
    )


@playground_router.post(
    "/sessions/{session_id}/panels/{panel_id}/run",
    response_model=RunPanelResponse,
)
async def run_panel(
    session_id: str,
    panel_id: Literal["a", "b"],
    request: RunPanelRequest,
) -> RunPanelResponse:
    session = PlaygroundSessionManager.load(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if panel_id == "a":
        session.pending_message_a = request.message
    else:
        session.pending_message_b = request.message
    PlaygroundSessionManager.save(session_id, session)

    return RunPanelResponse(
        stream_url=f"/ajax-api/3.0/mlflow/playground/sessions/{session_id}/panels/{panel_id}/stream",
    )


@playground_router.get("/sessions/{session_id}/panels/{panel_id}/stream")
async def stream_panel(
    session_id: str,
    panel_id: Literal["a", "b"],
) -> StreamingResponse:
    session = PlaygroundSessionManager.load(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if panel_id == "a":
        message = session.pending_message_a
        session.pending_message_a = None
    else:
        message = session.pending_message_b
        session.pending_message_b = None
    if not message:
        raise HTTPException(status_code=400, detail="No pending message to process")
    PlaygroundSessionManager.save(session_id, session)

    panel_config = session.config_a if panel_id == "a" else session.config_b
    workspace = PlaygroundSessionManager.get_workspace_dir(session_id) / f"panel-{panel_id}"
    provider_session_id = (
        session.provider_session_id_a if panel_id == "a" else session.provider_session_id_b
    )
    model = MODEL_MAP.get(panel_config.model, MODEL_MAP["sonnet"])

    async def event_generator() -> AsyncGenerator[str, None]:
        async for event in stream_panel_execution(
            message=message,
            cwd=workspace,
            model=model,
            allowed_tools=panel_config.allowed_tools,
            provider_session_id=provider_session_id,
            session_id=session_id,
            panel_id=panel_id,
        ):
            if event.type == EventType.DONE:
                new_provider_session_id = event.data.get("session_id")
                if new_provider_session_id:
                    updated_session = PlaygroundSessionManager.load(session_id)
                    if updated_session:
                        if panel_id == "a":
                            updated_session.provider_session_id_a = new_provider_session_id
                        else:
                            updated_session.provider_session_id_b = new_provider_session_id
                        PlaygroundSessionManager.save(session_id, updated_session)

            yield event.to_sse_event()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@playground_router.patch(
    "/sessions/{session_id}/panels/{panel_id}/cancel",
    response_model=CancelPanelResponse,
)
async def cancel_panel(
    session_id: str,
    panel_id: Literal["a", "b"],
) -> CancelPanelResponse:
    session = PlaygroundSessionManager.load(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    terminated = terminate_panel_process(session_id, panel_id)
    if terminated:
        return CancelPanelResponse(message="Process terminated")
    return CancelPanelResponse(message="No active process to cancel")
