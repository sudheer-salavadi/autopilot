import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_project_member, require_project_owner
from app.db.session import get_db
from app.models.integration import Integration
from app.schemas.integration import IntegrationCreate, IntegrationOut, IntegrationUpdate

router = APIRouter(prefix="/api/projects/{slug}/integrations", tags=["integrations"])


@router.get("", response_model=list[IntegrationOut])
async def list_integrations(
    deps=Depends(require_project_member),
    db: AsyncSession = Depends(get_db),
):
    project, _, __ = deps
    result = await db.execute(
        select(Integration).where(Integration.project_id == project.id)
    )
    return result.scalars().all()


@router.post("", response_model=IntegrationOut, status_code=status.HTTP_201_CREATED)
async def create_integration(
    body: IntegrationCreate,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, _, __ = deps
    integration = Integration(
        project_id=project.id,
        type=body.type,
        webhook_secret=body.webhook_secret,
        config=body.config,
    )
    db.add(integration)
    await db.flush()
    return integration


@router.put("/{integration_id}", response_model=IntegrationOut)
async def update_integration(
    integration_id: uuid.UUID,
    body: IntegrationUpdate,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, _, __ = deps
    result = await db.execute(
        select(Integration).where(
            Integration.id == integration_id,
            Integration.project_id == project.id,
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")

    if body.webhook_secret is not None:
        integration.webhook_secret = body.webhook_secret
    if body.is_active is not None:
        integration.is_active = body.is_active
    if body.config is not None:
        integration.config = body.config

    db.add(integration)
    return integration
