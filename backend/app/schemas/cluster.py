import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel

from app.models.cluster import ClusterStatus


class ClusterEventOut(BaseModel):
    id: uuid.UUID
    source: str
    event_type: str
    received_at: datetime
    payload: dict[str, Any]

    model_config = {"from_attributes": True}


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
    # PM synthesis
    pm_insight: str | None = None
    # Regression / GitHub fields
    parent_cluster_id: uuid.UUID | None = None
    regression_count: int = 0
    github_issue_number: int | None = None
    github_issue_url: str | None = None
    # Coding-agent fix tracking
    fix_provider: str | None = None
    fix_requested_at: datetime | None = None
    fix_pr_number: int | None = None
    fix_pr_url: str | None = None
    fix_pr_state: str | None = None
    event_ids: list[uuid.UUID] = []
    event_payloads: list[ClusterEventOut] | None = None

    model_config = {"from_attributes": True}


class ClustersPage(BaseModel):
    items: list[ClusterOut]
    total: int
    page: int
    page_size: int
