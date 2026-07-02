import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.services.crypto import EncryptedString


class ProjectWebhookSubscription(Base, TimestampMixin):
    """Outbound webhook — lets a third party (Slack app, custom dashboard, ...)
    react to pipeline stage transitions without polling. See app.services.webhook_dispatch
    for the event types and delivery logic.
    """
    __tablename__ = "project_webhook_subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    url: Mapped[str] = mapped_column(String, nullable=False)
    # HMAC-SHA256 signing key for the X-Autopilot-Signature header — encrypted at rest,
    # shown to the user only once (at creation / rotation).
    secret: Mapped[str] = mapped_column(EncryptedString, nullable=False)
    # Event types this subscription wants, e.g. ["cluster.created", "cluster.resolved"].
    # ["*"] subscribes to everything.
    event_types: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    last_delivery_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_delivery_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_delivery_error: Mapped[str | None] = mapped_column(String, nullable=True)
