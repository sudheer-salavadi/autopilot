import uuid

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ProjectAgentConfig(Base):
    """Per-project, per-provider settings for the "fix with a coding agent" feature.

    One row per (project, provider). Rows are created on demand (default: disabled,
    default trigger_template) the first time a project's agent config is read or written.
    """
    __tablename__ = "project_agent_config"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # "claude" | "codex" | "gemini" — see app.services.coding_agents.PROVIDERS
    provider: Mapped[str] = mapped_column(String, primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Null = use the provider's default_trigger_template
    trigger_template: Mapped[str | None] = mapped_column(String, nullable=True)
