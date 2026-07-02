import uuid

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ProjectAgentConfig(Base):
    """Per-project, per-provider settings for the "fix with a coding agent" feature.

    One row per (project, provider). For built-in providers (see
    app.services.coding_agents.PROVIDERS) rows are created on demand with
    name/trigger_template/setup_docs_url left null, meaning "inherit from the
    registry". A project can also define its own custom providers — any coding
    agent that watches GitHub comments — with is_custom=True and no registry
    entry to fall back on, so name/trigger_template must be set explicitly.
    """
    __tablename__ = "project_agent_config"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # Built-in: "claude" | "codex" | "gemini". Custom: any user-chosen slug.
    provider: Mapped[str] = mapped_column(String, primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Null = use the provider's default_trigger_template (built-ins only)
    trigger_template: Mapped[str | None] = mapped_column(String, nullable=True)
    # Null = use the registry name (built-ins only; required for custom providers)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    # Null = use the registry docs url (built-ins); optional for custom providers
    setup_docs_url: Mapped[str | None] = mapped_column(String, nullable=True)
    # True for user-defined providers — only these can be deleted outright
    is_custom: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
