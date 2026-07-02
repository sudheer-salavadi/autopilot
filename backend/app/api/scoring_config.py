from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_project_member, require_project_owner
from app.db.session import get_db
from app.models.cluster import Cluster, ClusterEvent
from app.models.event import Event
from app.models.scoring_config import ProjectScoringConfig
from app.schemas.scoring_config import ScoringConfigOut, ScoringConfigUpdate
from app.services.evaluator import _rescore_cluster
from app.services.webhook_dispatch import EVENT_CLUSTER_SCORED, cluster_payload, emit_event

router = APIRouter(prefix="/api/projects/{slug}", tags=["scoring-config"])


def _to_out(config: ProjectScoringConfig) -> ScoringConfigOut:
    out = ScoringConfigOut.model_validate(config)
    out.has_scoring_webhook_secret = bool(config.scoring_webhook_secret)
    return out


@router.get("/scoring-config", response_model=ScoringConfigOut)
async def get_scoring_config(
    deps=Depends(require_project_member),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps

    result = await db.execute(
        select(ProjectScoringConfig).where(ProjectScoringConfig.project_id == project.id)
    )
    config = result.scalar_one_or_none()
    if not config:
        config = ProjectScoringConfig(project_id=project.id)
        db.add(config)
        await db.flush()

    return _to_out(config)


@router.put("/scoring-config", response_model=ScoringConfigOut)
async def update_scoring_config(
    body: ScoringConfigUpdate,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps

    result = await db.execute(
        select(ProjectScoringConfig).where(ProjectScoringConfig.project_id == project.id)
    )
    config = result.scalar_one_or_none()
    if not config:
        config = ProjectScoringConfig(project_id=project.id)
        db.add(config)
        await db.flush()

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(config, field, value)

    # scoring_webhook_url/secret are nullable, so exclude_none above can't tell
    # "field omitted" from "explicitly cleared" (schema normalizes "" to None).
    # model_fields_set still distinguishes them regardless of the validated value.
    if "scoring_webhook_url" in body.model_fields_set:
        config.scoring_webhook_url = body.scoring_webhook_url
    if "scoring_webhook_secret" in body.model_fields_set:
        config.scoring_webhook_secret = body.scoring_webhook_secret

    await db.flush()

    # Rescore all clusters for this project
    result = await db.execute(
        select(Cluster).where(Cluster.project_id == project.id)
    )
    clusters = result.scalars().all()

    for cluster in clusters:
        result = await db.execute(
            select(Event)
            .join(ClusterEvent, ClusterEvent.event_id == Event.id)
            .where(ClusterEvent.cluster_id == cluster.id)
        )
        cluster_events = result.scalars().all()
        await _rescore_cluster(cluster, config, cluster_events)

    await db.commit()
    for cluster in clusters:
        emit_event(project.id, EVENT_CLUSTER_SCORED, cluster_payload(cluster))
    return _to_out(config)
