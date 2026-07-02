"""Per-project coding-agent config + "fix with <provider>" trigger endpoint.

Autopilot doesn't manage sessions for any coding agent itself — each provider is
a GitHub App/Action (installed separately by the user on their repo) that watches
for a trigger comment and opens a PR. Three providers ship as a registry
(app.services.coding_agents.PROVIDERS) with sensible defaults, but a project can
also define arbitrary custom providers — any agent that watches GitHub comments —
so adding support for a new vendor never requires an Autopilot code change.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_project_member, require_project_owner
from app.db.session import get_db
from app.models.agent_config import ProjectAgentConfig
from app.models.cluster import Cluster
from app.models.github_config import ProjectGithubConfig
from app.schemas.agent_config import (
    AgentFixRequest,
    AgentProviderCreate,
    AgentProviderOut,
    AgentProviderUpdate,
)
from app.services import github as gh
from app.services.coding_agents import PROVIDERS
from app.services.webhook_dispatch import EVENT_CLUSTER_FIX_REQUESTED, cluster_payload, emit_event

router = APIRouter(prefix="/api/projects/{slug}", tags=["agents"])


def _to_out(config: ProjectAgentConfig) -> AgentProviderOut:
    builtin = PROVIDERS.get(config.provider)
    name = config.name or (builtin.name if builtin else config.provider)
    template = config.trigger_template or (builtin.default_trigger_template if builtin else "")
    docs_url = config.setup_docs_url or (builtin.setup_docs_url if builtin else None)
    return AgentProviderOut(
        provider=config.provider,
        name=name,
        enabled=config.enabled,
        trigger_template=template,
        is_custom_template=config.trigger_template is not None,
        is_custom=config.is_custom,
        setup_docs_url=docs_url,
    )


def _default_out(provider_id: str) -> AgentProviderOut:
    """A built-in provider with no DB row yet — disabled, all registry defaults."""
    builtin = PROVIDERS[provider_id]
    return AgentProviderOut(
        provider=builtin.id,
        name=builtin.name,
        enabled=False,
        trigger_template=builtin.default_trigger_template,
        is_custom_template=False,
        is_custom=False,
        setup_docs_url=builtin.setup_docs_url,
    )


@router.get("/agent-config", response_model=list[AgentProviderOut])
async def list_agent_config(
    deps=Depends(require_project_member),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps
    result = await db.execute(
        select(ProjectAgentConfig).where(ProjectAgentConfig.project_id == project.id)
    )
    rows = {c.provider: c for c in result.scalars().all()}

    out = [
        _to_out(rows[pid]) if pid in rows else _default_out(pid)
        for pid in PROVIDERS
    ]
    out += [_to_out(row) for pid, row in rows.items() if pid not in PROVIDERS]
    return out


@router.post("/agent-config", response_model=AgentProviderOut, status_code=status.HTTP_201_CREATED)
async def create_custom_agent(
    body: AgentProviderCreate,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    """Register a custom coding-agent provider (any agent that watches GitHub comments)."""
    project, _, _ = deps

    if body.provider in PROVIDERS:
        raise HTTPException(
            status_code=409,
            detail=f"'{body.provider}' is a built-in provider — edit it instead of creating a new one.",
        )

    config = ProjectAgentConfig(
        project_id=project.id,
        provider=body.provider,
        enabled=body.enabled,
        name=body.name,
        trigger_template=body.trigger_template,
        setup_docs_url=body.setup_docs_url,
        is_custom=True,
    )
    db.add(config)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"A provider named '{body.provider}' already exists for this project.",
        )
    await db.refresh(config)
    return _to_out(config)


@router.put("/agent-config/{provider}", response_model=AgentProviderOut)
async def update_agent_config(
    provider: str,
    body: AgentProviderUpdate,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps

    result = await db.execute(
        select(ProjectAgentConfig).where(
            ProjectAgentConfig.project_id == project.id,
            ProjectAgentConfig.provider == provider,
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        if provider not in PROVIDERS:
            raise HTTPException(status_code=404, detail=f"Unknown provider '{provider}'")
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
    return _to_out(config)


@router.delete("/agent-config/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_custom_agent(
    provider: str,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    project, _, _ = deps

    result = await db.execute(
        select(ProjectAgentConfig).where(
            ProjectAgentConfig.project_id == project.id,
            ProjectAgentConfig.provider == provider,
        )
    )
    config = result.scalar_one_or_none()
    if not config or not config.is_custom:
        raise HTTPException(
            status_code=400,
            detail="Only custom providers can be deleted — disable a built-in one instead.",
        )

    await db.delete(config)
    await db.commit()


@router.post("/clusters/{cluster_id}/agent-fix")
async def trigger_agent_fix(
    cluster_id: uuid.UUID,
    body: AgentFixRequest,
    deps=Depends(require_project_owner),
    db: AsyncSession = Depends(get_db),
):
    """Post the provider's trigger comment on the cluster's filed GitHub issue."""
    project, _, _ = deps

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
            detail=f"'{body.provider}' is not enabled for this project. "
            "Enable it in Settings → Coding Agents first.",
        )
    out = _to_out(agent_config)

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

    try:
        await gh.add_issue_comment(
            repo=gh_config.repo,
            issue_number=cluster.github_issue_number,
            body=out.trigger_template,
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
    emit_event(project.id, EVENT_CLUSTER_FIX_REQUESTED, cluster_payload(cluster))

    return {
        "fix_provider": cluster.fix_provider,
        "fix_requested_at": cluster.fix_requested_at,
    }
