import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AuditLog(Base):
    """Append-only record of outward-facing and administrative actions.

    This is the accountability layer that was chosen *instead of* granular
    per-action permissions (see docs/platform-vision.md): teammates aren't
    prevented from filing issues or triggering agents — but every such
    action records who did it.

    project_id NULL = instance-level entry (admin user management).
    actor_id NULL + actor_email "autopilot"/"github" = system action.
    """

    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Snapshot so entries stay readable after a user is deleted
    actor_email: Mapped[str] = mapped_column(String, nullable=False, default="")
    # e.g. "cluster.issue_filed", "cluster.fix_requested", "user.role_changed"
    action: Mapped[str] = mapped_column(String, nullable=False)
    target_type: Mapped[str | None] = mapped_column(String, nullable=True)
    target_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # Human-readable one-liner: 'Filed GitHub issue acme/app#42 for "Checkout failures"'
    summary: Mapped[str] = mapped_column(String, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_audit_log_project_created", "project_id", "created_at"),
    )
