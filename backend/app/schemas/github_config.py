import uuid

from pydantic import BaseModel, field_validator


class GithubConfigOut(BaseModel):
    project_id: uuid.UUID
    repo: str | None
    installation_id: int | None
    is_installed: bool          # True when installation_id is set
    autopilot_enabled: bool
    autopilot_min_score: float

    model_config = {"from_attributes": True}


class GithubConfigUpdate(BaseModel):
    repo: str | None = None
    installation_id: int | None = None  # set by callback after GitHub App install
    autopilot_enabled: bool | None = None
    autopilot_min_score: float | None = None

    @field_validator("repo")
    @classmethod
    def validate_repo(cls, v: str | None) -> str | None:
        if v is not None and v != "" and "/" not in v:
            raise ValueError('repo must be in "owner/repo" format')
        return v or None

    @field_validator("autopilot_min_score")
    @classmethod
    def validate_score(cls, v: float | None) -> float | None:
        if v is not None and not (0.0 <= v <= 1.0):
            raise ValueError("autopilot_min_score must be between 0 and 1")
        return v
