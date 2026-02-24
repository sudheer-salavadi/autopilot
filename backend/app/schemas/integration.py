import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.integration import IntegrationType


class IntegrationCreate(BaseModel):
    type: IntegrationType
    webhook_secret: str
    config: dict = {}


class IntegrationUpdate(BaseModel):
    webhook_secret: str | None = None
    is_active: bool | None = None
    config: dict | None = None


class IntegrationOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    type: IntegrationType
    is_active: bool
    config: dict
    created_at: datetime
    # webhook_secret intentionally excluded

    model_config = {"from_attributes": True}
