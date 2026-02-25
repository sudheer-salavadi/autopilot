import uuid
from datetime import datetime

from pydantic import BaseModel

from app.models.cluster import ClusterStatus


class ClusterOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    title: str
    root_cause: str
    revenue_score: float
    frequency_score: float
    ux_score: float
    priority_score: float
    event_count: int
    affected_users: int
    first_seen: datetime
    last_seen: datetime
    status: ClusterStatus
    created_at: datetime
    updated_at: datetime
    event_ids: list[uuid.UUID] = []

    model_config = {"from_attributes": True}


class ClustersPage(BaseModel):
    items: list[ClusterOut]
    total: int
    page: int
    page_size: int
