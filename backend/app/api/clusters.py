import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import require_project_member, require_project_owner
from app.db.session import get_db
from app.models.cluster import Cluster, ClusterEvent, ClusterStatus
from app.models.event import Event
from app.schemas.cluster import ClusterEventOut, ClusterOut, ClustersPage
from app.services.evaluator import evaluate_project


class ClusterStatusUpdate(BaseModel):
    status: ClusterStatus

router = APIRouter(prefix="/api/projects/{slug}", tags=["clusters"])


@router.get("/clusters", response_model=ClustersPage)
async def list_clusters(
    page: int = 1,
    page_size: int = 100,
    # "active" (default) = open + investigating; "resolved" = resolved only
    view: str = Query(default="active", pattern="^(active|resolved)$"),
    # Optional filters
    source: str | None = Query(default=None),
    min_score: float | None = Query(default=None, ge=0.0, le=1.0),
    deps=Depends(require_project_member),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps

    offset = (page - 1) * page_size

    # Base status filter
    if view == "resolved":
        status_filter = Cluster.status == ClusterStatus.resolved
    else:
        status_filter = Cluster.status.in_([ClusterStatus.open, ClusterStatus.investigating])

    filters = [Cluster.project_id == project.id, status_filter]

    # Optional: filter clusters that contain at least one event from the given source
    if source:
        source_subq = (
            select(ClusterEvent.cluster_id)
            .join(Event, Event.id == ClusterEvent.event_id)
            .where(Event.source == source)
        )
        filters.append(Cluster.id.in_(source_subq))

    # Optional: minimum priority score
    if min_score is not None:
        filters.append(Cluster.priority_score >= min_score)

    count_result = await db.execute(
        select(func.count()).select_from(Cluster).where(*filters)
    )
    total = count_result.scalar_one()

    # Active clusters sort by score DESC; resolved by most-recently-resolved first
    order = Cluster.updated_at.desc() if view == "resolved" else Cluster.priority_score.desc()

    result = await db.execute(
        select(Cluster)
        .where(*filters)
        .options(selectinload(Cluster.cluster_events))
        .order_by(order)
        .offset(offset)
        .limit(page_size)
    )
    clusters = result.scalars().all()

    items = []
    for c in clusters:
        out = ClusterOut.model_validate(c)
        out.event_ids = [ce.event_id for ce in c.cluster_events]
        items.append(out)

    return ClustersPage(items=items, total=total, page=page, page_size=page_size)


@router.get("/clusters/{cluster_id}", response_model=ClusterOut)
async def get_cluster(
    cluster_id: uuid.UUID,
    deps=Depends(require_project_member),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps

    result = await db.execute(
        select(Cluster)
        .where(Cluster.id == cluster_id, Cluster.project_id == project.id)
        .options(selectinload(Cluster.cluster_events))
    )
    cluster = result.scalar_one_or_none()
    if not cluster:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cluster not found")

    events_result = await db.execute(
        select(Event)
        .join(ClusterEvent, ClusterEvent.event_id == Event.id)
        .where(ClusterEvent.cluster_id == cluster_id)
        .order_by(Event.received_at.desc())
        .limit(20)
    )
    events = events_result.scalars().all()

    out = ClusterOut.model_validate(cluster)
    out.event_ids = [ce.event_id for ce in cluster.cluster_events]
    out.event_payloads = [ClusterEventOut.model_validate(e) for e in events]
    return out


@router.patch("/clusters/{cluster_id}/status", response_model=ClusterOut)
async def update_cluster_status(
    cluster_id: uuid.UUID,
    body: ClusterStatusUpdate,
    deps=Depends(require_project_member),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps

    result = await db.execute(
        select(Cluster)
        .where(Cluster.id == cluster_id, Cluster.project_id == project.id)
        .options(selectinload(Cluster.cluster_events))
    )
    cluster = result.scalar_one_or_none()
    if not cluster:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cluster not found")

    cluster.status = body.status

    # Sync GitHub issue state when status changes to/from resolved
    if cluster.github_issue_number:
        from app.models.github_config import ProjectGithubConfig
        from app.services import github as gh
        gh_result = await db.execute(
            select(ProjectGithubConfig).where(
                ProjectGithubConfig.project_id == project.id
            )
        )
        gh_config = gh_result.scalar_one_or_none()
        if gh_config and gh_config.installation_id and gh_config.repo:
            try:
                if body.status == ClusterStatus.resolved:
                    await gh.close_issue(
                        repo=gh_config.repo,
                        issue_number=cluster.github_issue_number,
                        installation_id=gh_config.installation_id,
                    )
                elif body.status == ClusterStatus.open:
                    await gh.reopen_issue(
                        repo=gh_config.repo,
                        issue_number=cluster.github_issue_number,
                        installation_id=gh_config.installation_id,
                    )
            except Exception:
                pass  # Non-blocking — status is still updated locally

    await db.commit()
    await db.refresh(cluster)

    out = ClusterOut.model_validate(cluster)
    out.event_ids = [ce.event_id for ce in cluster.cluster_events]
    return out


@router.post("/clusters/evaluate")
async def trigger_evaluate(
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps
    stats = await evaluate_project(project.id, db)
    return stats
