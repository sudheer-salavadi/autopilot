"""Proactive scouts — scheduled, LLM-evaluated checks against an MCP-connected
data source. See app.services.scouts for what makes this different from
plain MCP polling.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_project_member, require_project_owner
from app.db.session import get_db
from app.models.integration import Integration, IntegrationType
from app.models.scout import ProjectScout
from app.schemas.scout import ScoutCreate, ScoutOut, ScoutRunResult, ScoutUpdate
from app.services.scouts import run_scout

router = APIRouter(prefix="/api/projects/{slug}", tags=["scouts"])


async def _get_mcp_integration(
    project_id: uuid.UUID, integration_id: uuid.UUID, db: AsyncSession
) -> Integration:
    result = await db.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.project_id == project_id,
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")
    if integration.type != IntegrationType.mcp_server:
        raise HTTPException(
            status_code=422,
            detail="Scouts can only target an MCP Server integration",
        )
    return integration


async def _get_scout(project_id: uuid.UUID, scout_id: uuid.UUID, db: AsyncSession) -> ProjectScout:
    result = await db.execute(
        select(ProjectScout).where(
            ProjectScout.id == scout_id,
            ProjectScout.project_id == project_id,
        )
    )
    scout = result.scalar_one_or_none()
    if not scout:
        raise HTTPException(status_code=404, detail="Scout not found")
    return scout


@router.get("/scouts", response_model=list[ScoutOut])
async def list_scouts(
    integration_id: uuid.UUID | None = Query(default=None),
    deps=Depends(require_project_member),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps
    filters = [ProjectScout.project_id == project.id]
    if integration_id:
        filters.append(ProjectScout.integration_id == integration_id)
    result = await db.execute(select(ProjectScout).where(*filters))
    return result.scalars().all()


@router.post("/scouts", response_model=ScoutOut, status_code=status.HTTP_201_CREATED)
async def create_scout(
    body: ScoutCreate,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps
    await _get_mcp_integration(project.id, body.integration_id, db)

    scout = ProjectScout(
        project_id=project.id,
        integration_id=body.integration_id,
        name=body.name,
        tool_name=body.tool_name,
        tool_arguments=body.tool_arguments,
        objective=body.objective,
        interval_seconds=body.interval_seconds,
        enabled=body.enabled,
    )
    db.add(scout)
    await db.commit()
    await db.refresh(scout)
    return scout


@router.patch("/scouts/{scout_id}", response_model=ScoutOut)
async def update_scout(
    scout_id: uuid.UUID,
    body: ScoutUpdate,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps
    scout = await _get_scout(project.id, scout_id, db)

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(scout, field, value)

    await db.commit()
    await db.refresh(scout)
    return scout


@router.delete("/scouts/{scout_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_scout(
    scout_id: uuid.UUID,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps
    scout = await _get_scout(project.id, scout_id, db)
    await db.delete(scout)
    await db.commit()


@router.post("/scouts/{scout_id}/run", response_model=ScoutRunResult)
async def run_scout_now(
    scout_id: uuid.UUID,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps
    scout = await _get_scout(project.id, scout_id, db)
    integration = await _get_mcp_integration(project.id, scout.integration_id, db)

    result = await run_scout(scout, integration, db)
    await db.commit()
    return ScoutRunResult(**result)
