from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class TopCluster(BaseModel):
    id: uuid.UUID
    title: str
    root_cause: str
    priority_score: float
    event_count: int
    affected_users: int
    status: str
    github_issue_number: int | None = None
    last_seen: datetime

    model_config = {"from_attributes": True}


class SourceStat(BaseModel):
    source: str
    count: int


class ClusterStats(BaseModel):
    active: int
    critical: int       # priority_score >= 0.7
    investigating: int
    resolved_30d: int


class DashboardOut(BaseModel):
    cluster_stats: ClusterStats
    affected_users: int             # distinct across active clusters
    revenue_at_risk_usd: float      # sum(revenue_score * max_revenue_usd)
    top_clusters: list[TopCluster]  # top 5 by priority_score
    events_24h: list[SourceStat]    # event counts by source, last 24 h
    total_events: int               # all-time events for project
