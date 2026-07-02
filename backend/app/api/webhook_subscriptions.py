"""Outbound webhook subscriptions — the "Slack app that reads clusters" extension
point. A third party registers a URL + which pipeline-stage events it wants
(cluster.created, cluster.scored, cluster.issue_filed, cluster.fix_requested,
cluster.fix_pr_linked, cluster.resolved) and Autopilot pushes them, HMAC-signed,
instead of requiring the third party to poll the REST API.
"""
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_project_member, require_project_owner
from app.db.session import get_db
from app.models.webhook_subscription import ProjectWebhookSubscription
from app.schemas.webhook_subscription import (
    WebhookSubscriptionCreate,
    WebhookSubscriptionCreated,
    WebhookSubscriptionOut,
    WebhookSubscriptionUpdate,
    WebhookTestResult,
)
from app.services.webhook_dispatch import EVENT_TYPES, deliver_test_event

router = APIRouter(prefix="/api/projects/{slug}", tags=["webhooks"])


def _to_out(sub: ProjectWebhookSubscription) -> WebhookSubscriptionOut:
    out = WebhookSubscriptionOut.model_validate(sub)
    out.secret_preview = f"…{sub.secret[-4:]}" if sub.secret else ""
    return out


async def _get_subscription(
    project_id: uuid.UUID, sub_id: uuid.UUID, db: AsyncSession
) -> ProjectWebhookSubscription:
    result = await db.execute(
        select(ProjectWebhookSubscription).where(
            ProjectWebhookSubscription.id == sub_id,
            ProjectWebhookSubscription.project_id == project_id,
        )
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Webhook subscription not found")
    return sub


@router.get("/webhook-subscriptions/event-types")
async def list_event_types(deps=Depends(require_project_member)):
    return EVENT_TYPES


@router.get("/webhook-subscriptions", response_model=list[WebhookSubscriptionOut])
async def list_webhook_subscriptions(
    deps=Depends(require_project_member),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps
    result = await db.execute(
        select(ProjectWebhookSubscription).where(
            ProjectWebhookSubscription.project_id == project.id
        )
    )
    return [_to_out(s) for s in result.scalars().all()]


@router.post(
    "/webhook-subscriptions",
    response_model=WebhookSubscriptionCreated,
    status_code=status.HTTP_201_CREATED,
)
async def create_webhook_subscription(
    body: WebhookSubscriptionCreate,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps
    secret = secrets.token_hex(32)
    sub = ProjectWebhookSubscription(
        project_id=project.id,
        url=body.url,
        secret=secret,
        event_types=body.event_types,
        enabled=body.enabled,
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)

    out = WebhookSubscriptionCreated.model_validate(sub)
    out.secret = secret
    out.secret_preview = f"…{secret[-4:]}"
    return out


@router.patch("/webhook-subscriptions/{sub_id}", response_model=WebhookSubscriptionOut)
async def update_webhook_subscription(
    sub_id: uuid.UUID,
    body: WebhookSubscriptionUpdate,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps
    sub = await _get_subscription(project.id, sub_id, db)

    if body.url is not None:
        sub.url = body.url
    if body.event_types is not None:
        sub.event_types = body.event_types
    if body.enabled is not None:
        sub.enabled = body.enabled

    new_secret = None
    if body.regenerate_secret:
        new_secret = secrets.token_hex(32)
        sub.secret = new_secret

    await db.commit()
    await db.refresh(sub)

    if new_secret:
        out = WebhookSubscriptionCreated.model_validate(sub)
        out.secret = new_secret
        out.secret_preview = f"…{new_secret[-4:]}"
        return out
    return _to_out(sub)


@router.delete("/webhook-subscriptions/{sub_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_webhook_subscription(
    sub_id: uuid.UUID,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps
    sub = await _get_subscription(project.id, sub_id, db)
    await db.delete(sub)
    await db.commit()


@router.post("/webhook-subscriptions/{sub_id}/test", response_model=WebhookTestResult)
async def test_webhook_subscription(
    sub_id: uuid.UUID,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps
    sub = await _get_subscription(project.id, sub_id, db)

    status_code, error = await deliver_test_event(sub)
    await db.commit()  # persist last_delivery_* fields set by deliver_test_event

    return WebhookTestResult(status_code=status_code, error=error)
