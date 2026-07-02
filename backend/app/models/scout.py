import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class ProjectScout(Base, TimestampMixin):
    """A named, scheduled proactive check against an MCP-connected data source.

    Unlike plain MCP polling (services/mcp_client.py's pull_mcp_server, which
    mirrors every tool result into an Event verbatim), a scout calls one tool
    with fixed arguments on its own schedule and runs the result through an
    LLM evaluation step (services/scouts.py) against a user-written objective.
    An Event is only created when that step decides there's a genuine finding
    — this is what makes it proactive detection rather than blind ingestion.
    """
    __tablename__ = "project_scouts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    # Must reference an Integration with type=mcp_server — the scout calls one
    # of that server's tools on a schedule.
    integration_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("integrations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    tool_name: Mapped[str] = mapped_column(String, nullable=False)
    tool_arguments: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    # Natural-language description of what this scout is watching for — passed
    # to the LLM alongside the tool result at evaluation time.
    objective: Mapped[str] = mapped_column(Text, nullable=False)
    interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=900)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_finding_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String, nullable=True)
