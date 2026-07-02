import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator

from app.services.webhook_dispatch import EVENT_TYPES


def _validate_event_types(v: list[str]) -> list[str]:
    if not v:
        raise ValueError("event_types must not be empty — pick at least one event, or [\"*\"] for all")
    allowed = set(EVENT_TYPES) | {"*"}
    invalid = [e for e in v if e not in allowed]
    if invalid:
        raise ValueError(f"Unknown event type(s): {invalid}. Valid: {EVENT_TYPES + ['*']}")
    return v


class WebhookSubscriptionOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    url: str
    event_types: list[str]
    enabled: bool
    created_at: datetime
    last_delivery_at: datetime | None = None
    last_delivery_status: int | None = None
    last_delivery_error: str | None = None
    # Last 4 chars only — the full secret is shown once, at creation/rotation
    secret_preview: str = ""

    model_config = {"from_attributes": True}


class WebhookSubscriptionCreated(WebhookSubscriptionOut):
    # Only present in the create response — shown once, never again
    secret: str


class WebhookSubscriptionCreate(BaseModel):
    url: str
    event_types: list[str]
    enabled: bool = True

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        v = v.strip()
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("url must start with http:// or https://")
        return v

    @field_validator("event_types")
    @classmethod
    def validate_event_types(cls, v: list[str]) -> list[str]:
        return _validate_event_types(v)


class WebhookSubscriptionUpdate(BaseModel):
    url: str | None = None
    event_types: list[str] | None = None
    enabled: bool | None = None
    regenerate_secret: bool = False

    @field_validator("event_types")
    @classmethod
    def validate_event_types(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        return _validate_event_types(v)


class WebhookTestResult(BaseModel):
    status_code: int | None
    error: str | None
