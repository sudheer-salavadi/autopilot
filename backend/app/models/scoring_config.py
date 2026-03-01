import uuid

from sqlalchemy import Boolean, Float, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


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

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="scoring_config")  # noqa: F821
