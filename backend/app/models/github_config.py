import uuid

from sqlalchemy import Boolean, Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.services.crypto import EncryptedString


class ProjectGithubConfig(Base):
    __tablename__ = "project_github_config"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # "owner/repo" — e.g. "acme/backend"
    repo: Mapped[str | None] = mapped_column(String, nullable=True)
    # Personal access token — Fernet-encrypted at rest, never returned in responses
    token: Mapped[str | None] = mapped_column(EncryptedString, nullable=True)
    # Webhook secret — set in GitHub repo settings, used to verify inbound payloads
    webhook_secret: Mapped[str | None] = mapped_column(EncryptedString, nullable=True)
    # Autopilot: auto-file GitHub issues when a cluster exceeds the min score
    autopilot_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    autopilot_min_score: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.7
    )

    project: Mapped["Project"] = relationship("Project", back_populates="github_config")  # noqa: F821
