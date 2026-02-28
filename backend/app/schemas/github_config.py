import uuid

from pydantic import BaseModel, field_validator


class GithubConfigOut(BaseModel):
    project_id: uuid.UUID
    repo: str | None
    has_token: bool           # True if a PAT is stored; never expose raw value
    has_webhook_secret: bool  # True if a webhook secret is stored
    autopilot_enabled: bool
    autopilot_min_score: float

    model_config = {"from_attributes": True}


class GithubConfigUpdate(BaseModel):
    repo: str | None = None
    token: str | None = None           # only sent when rotating; None = keep existing
    webhook_secret: str | None = None  # only sent when rotating
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
