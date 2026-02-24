import uuid
from datetime import datetime

from pydantic import BaseModel


class EventOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    integration_id: uuid.UUID | None
    source: str
    event_type: str
    payload: dict
    is_demo: bool
    received_at: datetime

    model_config = {"from_attributes": True}


class EventsPage(BaseModel):
    items: list[EventOut]
    total: int
    page: int
    page_size: int
