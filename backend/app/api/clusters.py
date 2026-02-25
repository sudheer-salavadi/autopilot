import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import require_project_member, require_project_owner
from app.db.session import get_db
from app.models.cluster import Cluster, ClusterEvent
from app.schemas.cluster import ClusterOut, ClustersPage
from app.services.evaluator import evaluate_project

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

    count_result = await db.execute(
        select(func.count()).select_from(Cluster).where(Cluster.project_id == project.id)
    )
    total = count_result.scalar_one()

    result = await db.execute(
        select(Cluster)
        .where(Cluster.project_id == project.id)
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
