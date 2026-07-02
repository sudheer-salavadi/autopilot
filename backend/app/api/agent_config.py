"""Per-project coding-agent config + "fix with <provider>" trigger endpoint.

Autopilot doesn't manage sessions for Claude/Codex/Gemini itself — each provider's
own GitHub App/Action (installed separately by the user on their repo) watches for a
trigger comment and opens a PR. This module just lets a project opt providers in,
posts the trigger comment on the already-filed GitHub issue, and records the request
so the resulting PR can be linked back (see webhook handling in app/api/webhooks.py).
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_project_member, require_project_owner
from app.db.session import get_db
from app.models.agent_config import ProjectAgentConfig
from app.models.cluster import Cluster
from app.models.github_config import ProjectGithubConfig
from app.schemas.agent_config import AgentFixRequest, AgentProviderOut, AgentProviderUpdate
from app.services import github as gh
from app.services.coding_agents import PROVIDERS

router = APIRouter(prefix="/api/projects/{slug}", tags=["agents"])


async def _get_configs(project_id: uuid.UUID, db: AsyncSession) -> dict[str, ProjectAgentConfig]:
    result = await db.execute(
        select(ProjectAgentConfig).where(ProjectAgentConfig.project_id == project_id)
    )
    return {c.provider: c for c in result.scalars().all()}


def _to_out(provider_id: str, config: ProjectAgentConfig | None) -> AgentProviderOut:
    provider = PROVIDERS[provider_id]
    custom_template = config.trigger_template if config else None
    return AgentProviderOut(
        provider=provider.id,
        name=provider.name,
        enabled=config.enabled if config else False,
        trigger_template=custom_template or provider.default_trigger_template,
        is_custom_template=custom_template is not None,
        setup_docs_url=provider.setup_docs_url,
    )


@router.get("/agent-config", response_model=list[AgentProviderOut])
async def list_agent_config(
    deps=Depends(require_project_member),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps
    configs = await _get_configs(project.id, db)
    return [_to_out(pid, configs.get(pid)) for pid in PROVIDERS]


@router.put("/agent-config/{provider}", response_model=AgentProviderOut)
async def update_agent_config(
    provider: str,
    body: AgentProviderUpdate,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps
    if provider not in PROVIDERS:
        raise HTTPException(status_code=404, detail=f"Unknown provider '{provider}'")

    result = await db.execute(
        select(ProjectAgentConfig).where(
            ProjectAgentConfig.project_id == project.id,
            ProjectAgentConfig.provider == provider,
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        config = ProjectAgentConfig(project_id=project.id, provider=provider)
        db.add(config)

    if body.enabled is not None:
        config.enabled = body.enabled
    if body.reset_template:
        config.trigger_template = None
    elif body.trigger_template is not None:
        config.trigger_template = body.trigger_template or None

    await db.commit()
    await db.refresh(config)
    return _to_out(provider, config)


@router.post("/clusters/{cluster_id}/agent-fix")
async def trigger_agent_fix(
    cluster_id: uuid.UUID,
    body: AgentFixRequest,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    """Post the provider's trigger comment on the cluster's filed GitHub issue."""
    project, _, _ = deps

    provider = PROVIDERS.get(body.provider)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Unknown provider '{body.provider}'")

    config_result = await db.execute(
        select(ProjectAgentConfig).where(
            ProjectAgentConfig.project_id == project.id,
            ProjectAgentConfig.provider == body.provider,
        )
    )
    agent_config = config_result.scalar_one_or_none()
    if not agent_config or not agent_config.enabled:
        raise HTTPException(
            status_code=422,
            detail=f"{provider.name} is not enabled for this project. "
            "Enable it in Settings → Coding Agents first.",
        )

    cluster_result = await db.execute(
        select(Cluster).where(Cluster.id == cluster_id, Cluster.project_id == project.id)
    )
    cluster = cluster_result.scalar_one_or_none()
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")
    if not cluster.github_issue_number:
        raise HTTPException(
            status_code=422,
            detail="File a GitHub issue for this cluster before requesting a fix.",
        )

    gh_config_result = await db.execute(
        select(ProjectGithubConfig).where(ProjectGithubConfig.project_id == project.id)
    )
    gh_config = gh_config_result.scalar_one_or_none()
    if not gh_config or not gh_config.installation_id or not gh_config.repo:
        raise HTTPException(
            status_code=422,
            detail="GitHub App must be installed and repo selected in Settings → GitHub",
        )

    trigger_body = agent_config.trigger_template or provider.default_trigger_template

    try:
        await gh.add_issue_comment(
            repo=gh_config.repo,
            issue_number=cluster.github_issue_number,
            body=trigger_body,
            installation_id=gh_config.installation_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"GitHub API error: {exc}")

    cluster.fix_provider = body.provider
    cluster.fix_requested_at = datetime.now(timezone.utc)
    # A fresh request supersedes any earlier PR link for a previous attempt
    cluster.fix_pr_number = None
    cluster.fix_pr_url = None
    cluster.fix_pr_state = None

    await db.commit()

    return {
        "fix_provider": cluster.fix_provider,
        "fix_requested_at": cluster.fix_requested_at,
    }
