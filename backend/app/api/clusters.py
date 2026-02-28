import uuid

from fastapi import APIRouter, Depends, HTTPException, status
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
    page_size: int = 20,
    deps=Depends(require_project_member),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps

    offset = (page - 1) * page_size

    active_filter = Cluster.status.in_(["open", "investigating"])

    count_result = await db.execute(
        select(func.count()).select_from(Cluster).where(
            Cluster.project_id == project.id, active_filter
        )
    )
    total = count_result.scalar_one()

    result = await db.execute(
        select(Cluster)
        .where(Cluster.project_id == project.id, active_filter)
        .options(selectinload(Cluster.cluster_events))
        .order_by(Cluster.priority_score.desc())
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

    # When resolving: if a GitHub issue is linked and we have a token, close it too
    if body.status == ClusterStatus.resolved and cluster.github_issue_number:
        from app.models.github_config import ProjectGithubConfig
        from app.services import github as gh
        gh_result = await db.execute(
            select(ProjectGithubConfig).where(
                ProjectGithubConfig.project_id == project.id
            )
        )
        gh_config = gh_result.scalar_one_or_none()
        if gh_config and gh_config.token and gh_config.repo:
            try:
                await gh.close_issue(
                    token=gh_config.token,
                    repo=gh_config.repo,
                    issue_number=cluster.github_issue_number,
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
