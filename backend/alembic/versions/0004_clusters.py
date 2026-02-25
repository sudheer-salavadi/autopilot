"""add clusters, cluster_events, project_scoring_config

Revision ID: 0004
Revises: 0003
Create Date: 2025-01-04 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Declare the enum separately so we control when it's created/dropped.
# create_type=False prevents op.create_table from trying to CREATE it again.
cluster_status_enum = postgresql.ENUM(
    "open", "investigating", "resolved",
    name="clusterstatus",
    create_type=False,
)


def upgrade() -> None:
    # Create enum type first, outside the table DDL.
    op.execute("CREATE TYPE clusterstatus AS ENUM ('open', 'investigating', 'resolved')")

    op.create_table(
        "clusters",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("root_cause", sa.String(), nullable=False),
        sa.Column("revenue_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("frequency_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("ux_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("priority_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("event_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("affected_users", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("first_seen", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", cluster_status_enum, nullable=False, server_default="open"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_clusters_project_priority", "clusters", ["project_id", "priority_score"])

    op.create_table(
        "cluster_events",
        sa.Column("cluster_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["cluster_id"], ["clusters.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("cluster_id", "event_id"),
        sa.UniqueConstraint("event_id"),
    )

    op.create_table(
        "project_scoring_config",
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("weight_revenue", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("weight_frequency", sa.Float(), nullable=False, server_default="0.3"),
        sa.Column("weight_ux", sa.Float(), nullable=False, server_default="0.2"),
        sa.Column("max_revenue_usd", sa.Float(), nullable=False, server_default="10000"),
        sa.Column("max_frequency_count", sa.Integer(), nullable=False, server_default="100"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id"),
    )


def downgrade() -> None:
    op.drop_table("project_scoring_config")
    op.drop_index("ix_clusters_project_priority", table_name="clusters")
    op.drop_table("cluster_events")
    op.drop_table("clusters")
    op.execute("DROP TYPE IF EXISTS clusterstatus")
