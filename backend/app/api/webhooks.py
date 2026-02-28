import asyncio
import hashlib
import hmac
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import AsyncSessionLocal, get_db
from app.models.cluster import Cluster, ClusterStatus
from app.models.event import Event
from app.models.github_config import ProjectGithubConfig
from app.models.integration import Integration, IntegrationType
from app.services.webhooks import (
    verify_fullstory_webhook,
    verify_sentry_webhook,
    verify_stripe_webhook,
)

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


async def _trigger_evaluate(project_id: uuid.UUID) -> None:
    """Run evaluate_project in a fresh DB session (safe for background tasks)."""
    from app.services.evaluator import evaluate_project
    try:
        async with AsyncSessionLocal() as db:
            await evaluate_project(project_id, db)
    except Exception:
        pass


async def _get_active_integration(
    project_id: uuid.UUID,
    integration_type: IntegrationType,
    db: AsyncSession,
) -> Integration:
    result = await db.execute(
        select(Integration).where(
            Integration.project_id == project_id,
            Integration.type == integration_type,
            Integration.is_active == True,  # noqa: E712
        )
    )
    integration = result.scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No active {integration_type} integration for this project",
        )
    return integration


@router.post("/{project_id}/stripe", status_code=status.HTTP_200_OK)
async def stripe_webhook(
    project_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    integration = await _get_active_integration(project_id, IntegrationType.stripe, db)
    event_data = await verify_stripe_webhook(request, integration.webhook_secret)

    # Idempotency: Stripe retries on non-200; skip if we already stored this event ID
    stripe_event_id = event_data.get("id")
    if stripe_event_id:
        existing = await db.execute(
            select(Event).where(
                Event.project_id == project_id,
                Event.source == "stripe",
                Event.payload["id"].astext == stripe_event_id,
            )
        )
        if existing.scalar_one_or_none():
            return {"received": True}

    db.add(Event(
        project_id=project_id,
        integration_id=integration.id,
        source="stripe",
        event_type=event_data.get("type", "unknown"),
        payload=event_data,
        is_demo=False,
    ))
    await db.commit()
    asyncio.create_task(_trigger_evaluate(project_id))
    return {"received": True}


@router.post("/{project_id}/sentry", status_code=status.HTTP_200_OK)
async def sentry_webhook(
    project_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    integration = await _get_active_integration(project_id, IntegrationType.sentry, db)
    payload = await verify_sentry_webhook(request, integration.webhook_secret)

    db.add(Event(
        project_id=project_id,
        integration_id=integration.id,
        source="sentry",
        event_type=payload.get("action", "unknown"),
        payload=payload,
        is_demo=False,
    ))
    await db.commit()
    asyncio.create_task(_trigger_evaluate(project_id))
    return {"received": True}


@router.post("/{project_id}/fullstory", status_code=status.HTTP_200_OK)
async def fullstory_webhook(
    project_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    integration = await _get_active_integration(project_id, IntegrationType.fullstory, db)
    payload = await verify_fullstory_webhook(request, integration.webhook_secret)

    db.add(Event(
        project_id=project_id,
        integration_id=integration.id,
        source="fullstory",
        event_type=payload.get("eventName", "unknown"),
        payload=payload,
        is_demo=False,
    ))
    await db.commit()
    asyncio.create_task(_trigger_evaluate(project_id))
    return {"received": True}


@router.post("/{project_id}/github", status_code=status.HTTP_200_OK)
async def github_webhook(
    project_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Receive GitHub issue events and sync cluster status.

    Events handled:
    - issues.closed   → cluster status = resolved
    - issues.reopened → cluster status = investigating
    """
    body = await request.body()

    # Load GitHub config to get webhook secret
    result = await db.execute(
        select(ProjectGithubConfig).where(
            ProjectGithubConfig.project_id == project_id
        )
    )
    gh_config = result.scalar_one_or_none()

    # Return 200 so GitHub doesn't disable the webhook even if unconfigured
    if not gh_config:
        return {"received": True}

    # Verify signature if a webhook secret is configured
    if gh_config.webhook_secret:
        sig_header = request.headers.get("X-Hub-Signature-256", "")
        expected = "sha256=" + hmac.new(
            gh_config.webhook_secret.encode(), body, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected, sig_header):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid webhook signature",
            )

    gh_event = request.headers.get("X-GitHub-Event", "")
    if gh_event != "issues":
        return {"received": True}

    try:
        import json
        payload = json.loads(body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    action = payload.get("action", "")
    issue_number = payload.get("issue", {}).get("number")

    if not issue_number or action not in ("closed", "reopened"):
        return {"received": True}

    # Find the cluster linked to this issue number
    cluster_result = await db.execute(
        select(Cluster).where(
            Cluster.project_id == project_id,
            Cluster.github_issue_number == issue_number,
        )
    )
    cluster = cluster_result.scalar_one_or_none()
    if not cluster:
        return {"received": True}

    if action == "closed":
        cluster.status = ClusterStatus.resolved
    elif action == "reopened":
        cluster.status = ClusterStatus.investigating

    await db.commit()
    return {"received": True}
