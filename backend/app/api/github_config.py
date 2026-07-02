"""GitHub App integration config + manual issue creation endpoints."""
import uuid
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_project_member, require_project_owner
from app.config import settings
from app.db.session import get_db
from app.models.cluster import Cluster, ClusterEvent
from app.models.event import Event
from app.models.github_config import ProjectGithubConfig
from app.schemas.github_config import GithubConfigOut, GithubConfigUpdate
from app.services import github as gh
from app.services.webhook_dispatch import EVENT_CLUSTER_ISSUE_FILED, cluster_payload, emit_event

router = APIRouter(prefix="/api/projects/{slug}", tags=["github"])


async def _get_or_create_config(
    project_id: uuid.UUID, db: AsyncSession
) -> ProjectGithubConfig:
    result = await db.execute(
        select(ProjectGithubConfig).where(
            ProjectGithubConfig.project_id == project_id
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        config = ProjectGithubConfig(project_id=project_id)
        db.add(config)
        await db.flush()
    return config


def _to_out(config: ProjectGithubConfig) -> GithubConfigOut:
    return GithubConfigOut(
        project_id=config.project_id,
        repo=config.repo,
        installation_id=config.installation_id,
        is_installed=config.installation_id is not None,
        autopilot_enabled=config.autopilot_enabled,
        autopilot_min_score=config.autopilot_min_score,
    )


@router.get("/github-config/debug-key")
async def debug_github_key(deps=Depends(require_project_owner)):
    """Diagnostic endpoint — shows key shape without exposing the key itself."""
    from app.config import settings
    raw = settings.GITHUB_APP_PRIVATE_KEY or ""
    normalized = gh._normalize_pem(raw)
    lines = normalized.splitlines()
    return {
        "app_id": settings.GITHUB_APP_ID,
        "raw_length": len(raw),
        "raw_first_20": raw[:20],
        "raw_last_20": raw[-20:],
        "normalized_length": len(normalized),
        "normalized_line_count": len(lines),
        "normalized_first_line": lines[0] if lines else "",
        "normalized_last_line": lines[-1] if lines else "",
        "has_begin_marker": "-----BEGIN" in normalized,
        "has_end_marker": "-----END" in normalized,
    }


@router.get("/github-config", response_model=GithubConfigOut)
async def get_github_config(
    deps=Depends(require_project_member),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps
    config = await _get_or_create_config(project.id, db)
    await db.commit()
    return _to_out(config)


@router.put("/github-config", response_model=GithubConfigOut)
async def update_github_config(
    body: GithubConfigUpdate,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps
    config = await _get_or_create_config(project.id, db)

    if body.installation_id is not None:
        config.installation_id = body.installation_id
    if body.repo is not None:
        config.repo = body.repo or None
    if body.autopilot_enabled is not None:
        config.autopilot_enabled = body.autopilot_enabled
    if body.autopilot_min_score is not None:
        config.autopilot_min_score = body.autopilot_min_score

    await db.commit()
    await db.refresh(config)
    return _to_out(config)


@router.get("/github-config/repos")
async def list_github_repos(
    deps=Depends(require_project_member),
    db: AsyncSession = Depends(get_db),
):
    """Return repos accessible to the installed GitHub App."""
    project, _, _ = deps
    config = await _get_or_create_config(project.id, db)

    if not config.installation_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="GitHub App is not installed for this project",
        )

    try:
        repos = await gh.get_accessible_repos(config.installation_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"GitHub API error: {exc}")

    return repos


@router.post("/github-config/verify")
async def verify_github_config(
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    """Test that the installation can access the configured repo."""
    project, _, _ = deps
    config = await _get_or_create_config(project.id, db)

    if not config.installation_id or not config.repo:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Repo and GitHub App installation must both be configured before verifying",
        )

    ok, message = await gh.verify_installation(config.installation_id, config.repo)
    return {"ok": ok, "message": message}


@router.post("/clusters/{cluster_id}/github-issue")
async def create_github_issue(
    cluster_id: uuid.UUID,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    """Manually file a GitHub issue for a cluster."""
    project, _, _ = deps

    # Load cluster
    result = await db.execute(
        select(Cluster).where(
            Cluster.id == cluster_id,
            Cluster.project_id == project.id,
        )
    )
    cluster = result.scalar_one_or_none()
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")

    if cluster.github_issue_number:
        raise HTTPException(
            status_code=409,
            detail=f"GitHub issue #{cluster.github_issue_number} already exists for this cluster",
        )

    # Load GitHub config
    gh_config = await _get_or_create_config(project.id, db)
    if not gh_config.installation_id or not gh_config.repo:
        raise HTTPException(
            status_code=422,
            detail="GitHub App must be installed and repo selected in Settings → GitHub",
        )

    # Count events by source
    events_result = await db.execute(
        select(Event.source)
        .join(ClusterEvent, ClusterEvent.event_id == Event.id)
        .where(ClusterEvent.cluster_id == cluster_id)
    )
    source_counts = dict(Counter(row[0] for row in events_result.all()))

    # Regression context
    is_regression = cluster.parent_cluster_id is not None
    parent_title = parent_issue_number = parent_issue_url = None
    if is_regression:
        parent_result = await db.execute(
            select(Cluster).where(Cluster.id == cluster.parent_cluster_id)
        )
        parent = parent_result.scalar_one_or_none()
        if parent:
            parent_title = parent.title
            parent_issue_number = parent.github_issue_number
            parent_issue_url = parent.github_issue_url

    body = gh.build_issue_body(
        cluster=cluster,
        project_slug=project.slug,
        frontend_url=settings.FRONTEND_URL,
        source_counts=source_counts,
        is_regression=is_regression,
        parent_title=parent_title,
        parent_issue_number=parent_issue_number,
        parent_issue_url=parent_issue_url,
    )

    try:
        issue = await gh.create_issue(
            repo=gh_config.repo,
            title=f"[Autopilot] {cluster.title}",
            body=body,
            labels=["autopilot"],
            installation_id=gh_config.installation_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"GitHub API error: {exc}")

    cluster.github_issue_number = issue["number"]
    cluster.github_issue_url = issue["html_url"]
    if cluster.status.value == "open":
        from app.models.cluster import ClusterStatus
        cluster.status = ClusterStatus.investigating

    await db.commit()
    emit_event(project.id, EVENT_CLUSTER_ISSUE_FILED, cluster_payload(cluster))

    return {
        "issue_number": issue["number"],
        "issue_url": issue["html_url"],
    }
