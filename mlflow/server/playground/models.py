from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class SkillEntry(BaseModel):
    name: str
    repo: str  # Local path or remote git URL
    commit_id: str  # Commit hash or "working-tree"


class PanelConfig(BaseModel):
    panel_id: Literal["a", "b"]
    skills: list[SkillEntry] = Field(default_factory=list)
    allowed_tools: list[str] = Field(default_factory=list)
    model: Literal["opus", "sonnet", "haiku"] = "sonnet"


class PlaygroundSessionData(BaseModel):
    session_id: str
    experiment_id: str
    created_at: datetime
    config_a: PanelConfig = Field(default_factory=lambda: PanelConfig(panel_id="a"))
    config_b: PanelConfig = Field(default_factory=lambda: PanelConfig(panel_id="b"))
    provider_session_id_a: str | None = None
    provider_session_id_b: str | None = None
    pending_message_a: str | None = None
    pending_message_b: str | None = None


# Request models


class CreateSessionRequest(BaseModel):
    experiment_id: str


class UpdatePanelConfigRequest(BaseModel):
    skills: list[SkillEntry] | None = None
    allowed_tools: list[str] | None = None
    model: Literal["opus", "sonnet", "haiku"] | None = None


# Response models


class SkillInfo(BaseModel):
    name: str


class CommitInfo(BaseModel):
    hash: str
    message: str


class SessionResponse(BaseModel):
    session_id: str
    experiment_id: str
    created_at: datetime
    config_a: PanelConfig
    config_b: PanelConfig


class ListSkillsResponse(BaseModel):
    skills: list[SkillInfo]


class ListCommitsResponse(BaseModel):
    commits: list[CommitInfo]


class RunPanelRequest(BaseModel):
    message: str


class RunPanelResponse(BaseModel):
    stream_url: str


class CancelPanelResponse(BaseModel):
    message: str
