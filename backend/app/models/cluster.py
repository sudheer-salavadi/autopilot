import enum
import uuid
from datetime import datetime, timezone

from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ClusterStatus(str, enum.Enum):
    open = "open"
    investigating = "investigating"
    resolved = "resolved"


class Cluster(Base):
    __tablename__ = "clusters"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String, nullable=False)
    root_cause: Mapped[str] = mapped_column(String, nullable=False)
    revenue_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    frequency_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    ux_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    priority_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    event_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    affected_users: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    first_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    last_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    status: Mapped[ClusterStatus] = mapped_column(
        Enum(ClusterStatus), nullable=False, default=ClusterStatus.open
    )

    # Semantic embedding (text-embedding-3-small, 1536 dims) for regression detection
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)

    # Regression tracking — parent_cluster_id links back to the original resolved cluster
    parent_cluster_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("clusters.id", ondelete="SET NULL"),
        nullable=True,
    )
    regression_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # GitHub issue filed for this cluster
    github_issue_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    github_issue_url: Mapped[str | None] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    project: Mapped["Project"] = relationship("Project", back_populates="clusters")  # noqa: F821
    cluster_events: Mapped[list["ClusterEvent"]] = relationship(
        "ClusterEvent", back_populates="cluster", cascade="all, delete-orphan"
    )


class ClusterEvent(Base):
    __tablename__ = "cluster_events"

    cluster_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clusters.id", ondelete="CASCADE"), primary_key=True
    )
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), primary_key=True
    )

    __table_args__ = (UniqueConstraint("event_id"),)

    # Relationships
    cluster: Mapped["Cluster"] = relationship("Cluster", back_populates="cluster_events")
    event: Mapped["Event"] = relationship("Event")  # noqa: F821
