"""Outbound event delivery — makes pipeline stage transitions independently
addressable by third parties (a Slack app, a custom dashboard, an internal
alerting tool) without them polling the REST API.

Each call to emit_event() is fire-and-forget: it schedules delivery on its own
asyncio task with its own DB session, so a slow or dead third-party endpoint
never blocks the calling pipeline stage (ingest/cluster/score/file-issue/
trigger-fix all call this synchronously in the middle of their own work).
"""
import asyncio
import hashlib
import hmac
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.webhook_subscription import ProjectWebhookSubscription

logger = logging.getLogger(__name__)

_TIMEOUT = 5.0

# The six pipeline-stage transitions a subscription can listen for.
# "*" (used in event_types) subscribes to all of them.
EVENT_CLUSTER_CREATED = "cluster.created"
EVENT_CLUSTER_SCORED = "cluster.scored"
EVENT_CLUSTER_ISSUE_FILED = "cluster.issue_filed"
EVENT_CLUSTER_FIX_REQUESTED = "cluster.fix_requested"
EVENT_CLUSTER_FIX_PR_LINKED = "cluster.fix_pr_linked"
EVENT_CLUSTER_RESOLVED = "cluster.resolved"

EVENT_TYPES = [
    EVENT_CLUSTER_CREATED,
    EVENT_CLUSTER_SCORED,
    EVENT_CLUSTER_ISSUE_FILED,
    EVENT_CLUSTER_FIX_REQUESTED,
    EVENT_CLUSTER_FIX_PR_LINKED,
    EVENT_CLUSTER_RESOLVED,
]


def cluster_payload(cluster: Any) -> dict:
    """Serialize a Cluster ORM object into a stable webhook payload shape."""
    return {
        "id": str(cluster.id),
        "project_id": str(cluster.project_id),
        "title": cluster.title,
        "root_cause": cluster.root_cause,
        "status": cluster.status.value if hasattr(cluster.status, "value") else cluster.status,
        "priority_score": cluster.priority_score,
        "revenue_score": cluster.revenue_score,
        "frequency_score": cluster.frequency_score,
        "ux_score": cluster.ux_score,
        "event_count": cluster.event_count,
        "affected_users": cluster.affected_users,
        "pm_insight": cluster.pm_insight,
        "regression_count": cluster.regression_count,
        "github_issue_number": cluster.github_issue_number,
        "github_issue_url": cluster.github_issue_url,
        "fix_provider": cluster.fix_provider,
        "fix_pr_number": cluster.fix_pr_number,
        "fix_pr_url": cluster.fix_pr_url,
        "fix_pr_state": cluster.fix_pr_state,
    }


def emit_event(project_id: uuid.UUID, event_type: str, data: dict) -> None:
    """Schedule delivery of `event_type` to every matching subscription.

    Never raises and never awaits network I/O on the caller's behalf — safe to
    call from inside a request handler or the middle of an evaluation pass.
    """
    asyncio.create_task(_deliver(project_id, event_type, data))


async def _deliver(project_id: uuid.UUID, event_type: str, data: dict) -> None:
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(ProjectWebhookSubscription).where(
                    ProjectWebhookSubscription.project_id == project_id,
                    ProjectWebhookSubscription.enabled == True,  # noqa: E712
                )
            )
            targets = [
                s
                for s in result.scalars().all()
                if event_type in (s.event_types or []) or "*" in (s.event_types or [])
            ]
            if not targets:
                return

            body = json.dumps(
                {
                    "event": event_type,
                    "project_id": str(project_id),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "data": data,
                },
                default=str,
            ).encode()

            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                for sub in targets:
                    await _deliver_one(client, sub, event_type, body)
                    db.add(sub)
            await db.commit()
    except Exception:
        logger.exception("Webhook dispatch failed for project=%s event=%s", project_id, event_type)


async def _deliver_one(
    client: httpx.AsyncClient,
    sub: ProjectWebhookSubscription,
    event_type: str,
    body: bytes,
) -> None:
    signature = hmac.new(sub.secret.encode(), body, hashlib.sha256).hexdigest()
    status_code: int | None = None
    error: str | None = None
    try:
        resp = await client.post(
            sub.url,
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Autopilot-Event": event_type,
                "X-Autopilot-Signature": f"sha256={signature}",
            },
        )
        status_code = resp.status_code
    except Exception as exc:
        error = str(exc)[:500]
        logger.warning("Webhook delivery failed url=%s event=%s: %s", sub.url, event_type, error)

    sub.last_delivery_at = datetime.now(timezone.utc)
    sub.last_delivery_status = status_code
    sub.last_delivery_error = error


async def deliver_test_event(sub: ProjectWebhookSubscription) -> tuple[int | None, str | None]:
    """Synchronous single-delivery used by the "Test" button in the UI.

    Unlike emit_event, this awaits the actual HTTP call and returns the result
    directly, since the user is deliberately watching for it.
    """
    body = json.dumps(
        {
            "event": "ping",
            "project_id": str(sub.project_id),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": {"message": "Test delivery from Autopilot"},
        }
    ).encode()
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        await _deliver_one(client, sub, "ping", body)
    return sub.last_delivery_status, sub.last_delivery_error
