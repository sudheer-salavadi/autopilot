from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_project_member
from app.db.session import get_db
from app.models.cluster import Cluster, ClusterStatus
from app.models.event import Event
from app.models.scoring_config import ProjectScoringConfig
from app.schemas.dashboard import ClusterStats, DashboardOut, SourceStat, TopCluster

router = APIRouter(prefix="/api/projects/{slug}", tags=["dashboard"])


@router.get("/dashboard", response_model=DashboardOut)
async def get_dashboard(
    deps=Depends(require_project_member),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps
    pid = project.id
    now = datetime.now(timezone.utc)
    cutoff_24h = now - timedelta(hours=24)
    cutoff_30d = now - timedelta(days=30)

    # ── Scoring config (for revenue_at_risk calculation) ──────────────────────
    cfg_result = await db.execute(
        select(ProjectScoringConfig).where(ProjectScoringConfig.project_id == pid)
    )
    cfg = cfg_result.scalar_one_or_none()
    max_revenue_usd = cfg.max_revenue_usd if cfg else 10_000.0

    # ── Active clusters (open + investigating) ────────────────────────────────
    active_q = await db.execute(
        select(Cluster).where(
            Cluster.project_id == pid,
            Cluster.status.in_([ClusterStatus.open, ClusterStatus.investigating]),
        )
    )
    active_clusters = active_q.scalars().all()

    active_count = len(active_clusters)
    critical_count = sum(1 for c in active_clusters if c.priority_score >= 0.7)
    investigating_count = sum(1 for c in active_clusters if c.status == ClusterStatus.investigating)

    # Affected users — sum across active clusters (not distinct across events, but adequate)
    affected_users = sum(c.affected_users for c in active_clusters)

    # Revenue at risk — sum revenue_score * max_revenue_usd
    revenue_at_risk = sum(c.revenue_score * max_revenue_usd for c in active_clusters)

    # ── Resolved in last 30 days ──────────────────────────────────────────────
    resolved_30d_result = await db.execute(
        select(func.count()).select_from(Cluster).where(
            Cluster.project_id == pid,
            Cluster.status == ClusterStatus.resolved,
            Cluster.updated_at >= cutoff_30d,
        )
    )
    resolved_30d = resolved_30d_result.scalar_one()

    # ── Top 5 clusters ────────────────────────────────────────────────────────
    top_q = await db.execute(
        select(Cluster)
        .where(
            Cluster.project_id == pid,
            Cluster.status.in_([ClusterStatus.open, ClusterStatus.investigating]),
        )
        .order_by(Cluster.priority_score.desc())
        .limit(5)
    )
    top_clusters = [
        TopCluster(
            id=c.id,
            title=c.title,
            root_cause=c.root_cause,
            priority_score=c.priority_score,
            event_count=c.event_count,
            affected_users=c.affected_users,
            status=c.status.value,
            github_issue_number=c.github_issue_number,
            last_seen=c.last_seen,
        )
        for c in top_q.scalars().all()
    ]

    # ── Events last 24 h by source ────────────────────────────────────────────
    events_24h_result = await db.execute(
        select(Event.source, func.count().label("cnt"))
        .where(
            Event.project_id == pid,
            Event.received_at >= cutoff_24h,
        )
        .group_by(Event.source)
        .order_by(func.count().desc())
    )
    events_24h = [
        SourceStat(source=row.source, count=row.cnt)
        for row in events_24h_result.all()
    ]

    # ── Total events all-time ─────────────────────────────────────────────────
    total_result = await db.execute(
        select(func.count()).select_from(Event).where(Event.project_id == pid)
    )
    total_events = total_result.scalar_one()

    return DashboardOut(
        cluster_stats=ClusterStats(
            active=active_count,
            critical=critical_count,
            investigating=investigating_count,
            resolved_30d=resolved_30d,
        ),
        affected_users=affected_users,
        revenue_at_risk_usd=revenue_at_risk,
        top_clusters=top_clusters,
        events_24h=events_24h,
        total_events=total_events,
    )
