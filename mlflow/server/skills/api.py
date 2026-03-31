"""Skill Registry API endpoints for MLflow Server."""

import logging
import traceback

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from mlflow.exceptions import MlflowException

_logger = logging.getLogger(__name__)

skills_router = APIRouter(
    prefix="/ajax-api/3.0/mlflow/skills",
    tags=["skills"],
)


# ============================================================================
# Request / Response Models
# ============================================================================


class RegisterSkillRequest(BaseModel):
    source: str
    tags: dict[str, str] | None = None


class SkillResponse(BaseModel):
    name: str
    description: str | None = None
    creation_timestamp: int | None = None
    last_updated_timestamp: int | None = None
    latest_version: int | None = None
    aliases: list[dict] = []
    source: str | None = None
    tags: dict[str, str] = {}
    created_by: str | None = None


class SkillVersionResponse(BaseModel):
    name: str
    version: int
    source: str | None = None
    description: str | None = None
    manifest_content: str | None = None
    artifact_location: str | None = None
    creation_timestamp: int | None = None
    tags: dict[str, str] = {}
    aliases: list[str] = []


class SetTagRequest(BaseModel):
    key: str
    value: str


class SetAliasRequest(BaseModel):
    alias: str
    version: int


# ============================================================================
# Helpers
# ============================================================================


def _skill_to_response(skill, latest_version_entity=None) -> SkillResponse:
    tags = {}
    source = None
    if latest_version_entity:
        tags = latest_version_entity.tags or {}
        source = latest_version_entity.source
    return SkillResponse(
        name=skill.name,
        description=skill.description,
        creation_timestamp=skill.creation_timestamp,
        last_updated_timestamp=skill.last_updated_timestamp,
        latest_version=skill.latest_version,
        aliases=[
            {"alias": a.alias, "version": a.version} for a in skill.aliases
        ],
        source=source,
        tags=tags,
    )


def _version_to_response(sv) -> SkillVersionResponse:
    return SkillVersionResponse(
        name=sv.name,
        version=sv.version,
        source=sv.source,
        description=sv.description,
        manifest_content=sv.manifest_content,
        artifact_location=sv.artifact_location,
        creation_timestamp=sv.creation_timestamp,
        tags=sv.tags,
        aliases=sv.aliases,
    )


def _handle_mlflow_exception(e: MlflowException):
    from mlflow.protos.databricks_pb2 import RESOURCE_DOES_NOT_EXIST

    if e.error_code == "RESOURCE_DOES_NOT_EXIST":
        raise HTTPException(status_code=404, detail=str(e))
    raise HTTPException(status_code=400, detail=str(e))


# ============================================================================
# Endpoints
# ============================================================================


@skills_router.post("/register")
async def register_skills(request: RegisterSkillRequest) -> list[SkillVersionResponse]:
    from mlflow.genai.skills import register_skill

    _logger.info("register_skills called with source=%s", request.source)
    try:
        versions = register_skill(source=request.source, tags=request.tags)
        _logger.info("Registered %d skill versions", len(versions))
        return [_version_to_response(sv) for sv in versions]
    except MlflowException as e:
        _logger.error("Failed to register skill: %s", e, exc_info=True)
        _handle_mlflow_exception(e)
    except Exception as e:
        _logger.error("Unexpected error registering skill: %s\n%s", e, traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@skills_router.get("/")
async def list_skills(
    filter: str | None = None, max_results: int = 100
) -> list[SkillResponse]:
    from mlflow.genai.skills import search_skills
    from mlflow.tracking.client import MlflowClient

    try:
        skills = search_skills(filter_string=filter, max_results=max_results)
        client = MlflowClient()
        results = []
        for s in skills:
            latest_sv = None
            if s.latest_version:
                try:
                    latest_sv = client.get_skill_version(s.name, s.latest_version)
                except MlflowException:
                    pass
            results.append(_skill_to_response(s, latest_sv))
        return results
    except MlflowException as e:
        _handle_mlflow_exception(e)


@skills_router.get("/{name}")
async def get_skill(name: str) -> dict:
    from mlflow.tracking.client import MlflowClient

    try:
        client = MlflowClient()
        skill = client.get_skill(name)
        # Also fetch versions
        versions = []
        if skill.latest_version:
            for v in range(1, skill.latest_version + 1):
                try:
                    sv = client.get_skill_version(name, v)
                    versions.append(_version_to_response(sv))
                except MlflowException:
                    continue
        return {
            "skill": _skill_to_response(skill),
            "versions": versions,
        }
    except MlflowException as e:
        _handle_mlflow_exception(e)


@skills_router.delete("/{name}")
async def delete_skill(name: str) -> dict:
    from mlflow.tracking.client import MlflowClient

    try:
        MlflowClient().delete_skill(name)
        return {"status": "deleted"}
    except MlflowException as e:
        _handle_mlflow_exception(e)


@skills_router.get("/{name}/versions/{version}")
async def get_skill_version(name: str, version: int) -> SkillVersionResponse:
    from mlflow.tracking.client import MlflowClient

    try:
        sv = MlflowClient().get_skill_version(name, version)
        return _version_to_response(sv)
    except MlflowException as e:
        _handle_mlflow_exception(e)


@skills_router.delete("/{name}/versions/{version}")
async def delete_skill_version(name: str, version: int) -> dict:
    from mlflow.tracking.client import MlflowClient

    try:
        MlflowClient().delete_skill_version(name, version)
        return {"status": "deleted"}
    except MlflowException as e:
        _handle_mlflow_exception(e)


@skills_router.post("/{name}/versions/{version}/tags")
async def set_skill_version_tag(name: str, version: int, request: SetTagRequest) -> dict:
    from mlflow.tracking.client import MlflowClient

    try:
        MlflowClient().set_skill_version_tag(name, version, request.key, request.value)
        return {"status": "ok"}
    except MlflowException as e:
        _handle_mlflow_exception(e)


@skills_router.delete("/{name}/versions/{version}/tags/{key}")
async def delete_skill_version_tag(name: str, version: int, key: str) -> dict:
    from mlflow.tracking.client import MlflowClient

    try:
        MlflowClient().delete_skill_version_tag(name, version, key)
        return {"status": "deleted"}
    except MlflowException as e:
        _handle_mlflow_exception(e)


@skills_router.post("/{name}/aliases")
async def set_skill_alias(name: str, request: SetAliasRequest) -> dict:
    from mlflow.tracking.client import MlflowClient

    try:
        MlflowClient().set_skill_alias(name, request.alias, request.version)
        return {"status": "ok"}
    except MlflowException as e:
        _handle_mlflow_exception(e)


@skills_router.delete("/{name}/aliases/{alias}")
async def delete_skill_alias(name: str, alias: str) -> dict:
    from mlflow.tracking.client import MlflowClient

    try:
        MlflowClient().delete_skill_alias(name, alias)
        return {"status": "deleted"}
    except MlflowException as e:
        _handle_mlflow_exception(e)
