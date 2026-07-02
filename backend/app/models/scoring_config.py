import uuid

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.services.crypto import EncryptedString


class ProjectScoringConfig(Base):
    __tablename__ = "project_scoring_config"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    weight_revenue: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    weight_frequency: Mapped[float] = mapped_column(Float, nullable=False, default=0.3)
    weight_ux: Mapped[float] = mapped_column(Float, nullable=False, default=0.2)
    max_revenue_usd: Mapped[float] = mapped_column(Float, nullable=False, default=10000.0)
    max_frequency_count: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    cross_channel: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    simulate_stripe: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    simulate_sentry: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    simulate_fullstory: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    simulate_zendesk: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Pluggable scoring — when set, the score stage POSTs raw signal data here
    # (HMAC-signed) and uses the returned scores instead of the internal formula,
    # falling back to it on any failure. See app.services.evaluator._rescore_cluster.
    scoring_webhook_url: Mapped[str | None] = mapped_column(String, nullable=True)
    scoring_webhook_secret: Mapped[str | None] = mapped_column(EncryptedString, nullable=True)

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="scoring_config")  # noqa: F821
