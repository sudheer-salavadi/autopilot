import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator

_ALLOWED_INTERVALS = {300, 900, 3600}  # 5 min / 15 min / 1 hour — same choices as MCP polling


class ScoutOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    integration_id: uuid.UUID
    name: str
    tool_name: str
    tool_arguments: dict
    objective: str
    interval_seconds: int
    enabled: bool
    last_run_at: datetime | None = None
    last_finding_at: datetime | None = None
    last_error: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ScoutCreate(BaseModel):
    integration_id: uuid.UUID
    name: str
    tool_name: str
    tool_arguments: dict = {}
    objective: str
    interval_seconds: int = 900
    enabled: bool = True

    @field_validator("name", "tool_name", "objective")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be empty")
        return v.strip()

    @field_validator("interval_seconds")
    @classmethod
    def valid_interval(cls, v: int) -> int:
        if v not in _ALLOWED_INTERVALS:
            raise ValueError(f"interval_seconds must be one of {sorted(_ALLOWED_INTERVALS)}")
        return v


class ScoutUpdate(BaseModel):
    name: str | None = None
    tool_name: str | None = None
    tool_arguments: dict | None = None
    objective: str | None = None
    interval_seconds: int | None = None
    enabled: bool | None = None

    @field_validator("interval_seconds")
    @classmethod
    def valid_interval(cls, v: int | None) -> int | None:
        if v is not None and v not in _ALLOWED_INTERVALS:
            raise ValueError(f"interval_seconds must be one of {sorted(_ALLOWED_INTERVALS)}")
        return v


class ScoutRunResult(BaseModel):
    notable: bool
    summary: str | None
    error: str | None
