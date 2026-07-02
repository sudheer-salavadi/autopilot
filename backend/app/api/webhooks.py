import hashlib
import hmac
import json
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import get_db
from app.models.cluster import Cluster, ClusterStatus
from app.models.event import Event
from app.models.github_config import ProjectGithubConfig
from app.models.integration import Integration, IntegrationType
from app.services.outbox import enqueue_evaluation
from app.services.webhook_dispatch import (
    EVENT_CLUSTER_FIX_PR_LINKED,
    EVENT_CLUSTER_RESOLVED,
    cluster_payload,
    emit_event,
)
from app.services.webhooks import (
    verify_fullstory_webhook,
    verify_sentry_webhook,
    verify_stripe_webhook,
    verify_zendesk_webhook,
)

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])

# Matches GitHub's own "closing keyword" convention (Fixes #12, Closes #34, Resolves #56, ...)
# so we only link a PR to a cluster's issue when the PR actually claims to resolve it.
_CLOSES_ISSUE_RE = re.compile(
    r"(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)", re.IGNORECASE
)


def _referenced_issue_numbers(pull_request: dict) -> set[int]:
    text = f"{pull_request.get('title', '')}\n{pull_request.get('body') or ''}"
    return {int(n) for n in _CLOSES_ISSUE_RE.findall(text)}


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
    # Enqueue before commit so the job and event are written atomically
    await enqueue_evaluation(project_id, db)
    await db.commit()
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
    await enqueue_evaluation(project_id, db)
    await db.commit()
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
        event_type=payload.get("eventName") or payload.get("name", "unknown"),
        payload=payload,
        is_demo=False,
    ))
    await enqueue_evaluation(project_id, db)
    await db.commit()
    return {"received": True}


@router.post("/{project_id}/zendesk", status_code=status.HTTP_200_OK)
async def zendesk_webhook(
    project_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    integration = await _get_active_integration(project_id, IntegrationType.zendesk, db)
    payload = await verify_zendesk_webhook(request, integration.webhook_secret)

    # Real Zendesk schema: top-level "type" field, e.g. "zen:event-type:ticket.created"
    event_type = payload.get("type", "unknown")

    db.add(Event(
        project_id=project_id,
        integration_id=integration.id,
        source="zendesk",
        event_type=event_type,
        payload=payload,
        is_demo=False,
    ))
    await enqueue_evaluation(project_id, db)
    await db.commit()
    return {"received": True}


# ---------------------------------------------------------------------------
# GitHub App — single shared webhook for the whole app
# ---------------------------------------------------------------------------

@router.post("/github-app", status_code=status.HTTP_200_OK)
async def github_app_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Shared GitHub App webhook — receives events from all installations.

    Events handled:
    - installation.deleted  → clear installation_id on all matching projects
    - issues.closed         → cluster status = resolved
    - issues.reopened       → cluster status = investigating
    """
    body = await request.body()

    # Verify HMAC signature using the App-level webhook secret
    webhook_secret = settings.GITHUB_APP_WEBHOOK_SECRET
    if webhook_secret:
        sig_header = request.headers.get("X-Hub-Signature-256", "")
        expected = "sha256=" + hmac.new(
            webhook_secret.encode(), body, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected, sig_header):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid webhook signature",
            )

    gh_event = request.headers.get("X-GitHub-Event", "")

    try:
        payload = json.loads(body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    action = payload.get("action", "")

    # ── installation.deleted: unlink from all projects that used this installation ──
    if gh_event == "installation" and action == "deleted":
        installation_id = payload.get("installation", {}).get("id")
        if installation_id:
            result = await db.execute(
                select(ProjectGithubConfig).where(
                    ProjectGithubConfig.installation_id == installation_id
                )
            )
            for cfg in result.scalars().all():
                cfg.installation_id = None
            await db.commit()
        return {"received": True}

    # ── issues.closed / issues.reopened: sync cluster status ──
    if gh_event == "issues" and action in ("closed", "reopened"):
        installation_id = payload.get("installation", {}).get("id")
        issue_number = payload.get("issue", {}).get("number")

        if not installation_id or not issue_number:
            return {"received": True}

        # Find the project linked to this installation
        cfg_result = await db.execute(
            select(ProjectGithubConfig).where(
                ProjectGithubConfig.installation_id == installation_id
            )
        )
        gh_config = cfg_result.scalar_one_or_none()
        if not gh_config:
            return {"received": True}

        # Find the cluster linked to this issue number
        cluster_result = await db.execute(
            select(Cluster).where(
                Cluster.project_id == gh_config.project_id,
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
        if action == "closed":
            emit_event(cluster.project_id, EVENT_CLUSTER_RESOLVED, cluster_payload(cluster))

    # ── pull_request: link a fix PR back to the cluster whose issue it closes ──
    if gh_event == "pull_request":
        installation_id = payload.get("installation", {}).get("id")
        repo_full_name = payload.get("repository", {}).get("full_name")
        pr = payload.get("pull_request", {})
        pr_number = pr.get("number")

        if not installation_id or not repo_full_name or not pr_number:
            return {"received": True}

        cfg_result = await db.execute(
            select(ProjectGithubConfig).where(
                ProjectGithubConfig.installation_id == installation_id,
                ProjectGithubConfig.repo == repo_full_name,
            )
        )
        gh_config = cfg_result.scalar_one_or_none()
        if not gh_config:
            return {"received": True}

        if action in ("opened", "edited", "reopened"):
            issue_numbers = _referenced_issue_numbers(pr)
            if issue_numbers:
                clusters_result = await db.execute(
                    select(Cluster).where(
                        Cluster.project_id == gh_config.project_id,
                        Cluster.github_issue_number.in_(issue_numbers),
                    )
                )
                linked = clusters_result.scalars().all()
                for cluster in linked:
                    cluster.fix_pr_number = pr_number
                    cluster.fix_pr_url = pr.get("html_url")
                    cluster.fix_pr_state = "open"
                await db.commit()
                for cluster in linked:
                    emit_event(cluster.project_id, EVENT_CLUSTER_FIX_PR_LINKED, cluster_payload(cluster))

        elif action == "closed":
            clusters_result = await db.execute(
                select(Cluster).where(
                    Cluster.project_id == gh_config.project_id,
                    Cluster.fix_pr_number == pr_number,
                )
            )
            closed_clusters = clusters_result.scalars().all()
            for cluster in closed_clusters:
                cluster.fix_pr_state = "merged" if pr.get("merged") else "closed"
            await db.commit()
            for cluster in closed_clusters:
                emit_event(cluster.project_id, EVENT_CLUSTER_FIX_PR_LINKED, cluster_payload(cluster))

    return {"received": True}


# ---------------------------------------------------------------------------
# Per-project GitHub webhook (legacy — kept for backward compat, no-ops)
# ---------------------------------------------------------------------------

@router.post("/{project_id}/github", status_code=status.HTTP_200_OK)
async def github_webhook_legacy(
    project_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Legacy per-project GitHub webhook endpoint.

    Now that the App sends all events to /api/webhooks/github-app, this
    endpoint is a no-op.  Kept so existing webhook URLs don't 404.
    """
    return {"received": True}
