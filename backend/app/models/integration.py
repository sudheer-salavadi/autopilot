import enum
import uuid

from sqlalchemy import Boolean, Enum, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.services.crypto import EncryptedString


class IntegrationType(str, enum.Enum):
    stripe = "stripe"
    sentry = "sentry"
    fullstory = "fullstory"


class Integration(Base, TimestampMixin):
    __tablename__ = "integrations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[IntegrationType] = mapped_column(Enum(IntegrationType), nullable=False)
    webhook_secret: Mapped[str] = mapped_column(EncryptedString, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    config: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="integrations")  # noqa: F821
    events: Mapped[list["Event"]] = relationship(  # noqa: F821
        "Event", back_populates="integration"
    )
