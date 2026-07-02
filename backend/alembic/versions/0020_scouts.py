"""Proactive scouts: scheduled, LLM-evaluated checks against MCP-connected sources.

Adds project_scouts. Each scout calls one tool on an existing mcp_server
Integration with fixed arguments, on its own schedule, and only creates an
Event when the LLM evaluation step (services/scouts.py) decides the result
is a genuine finding — proactive detection layered on top of the existing
generic MCP polling, not a replacement for it.

Revision ID: 0020
Revises: 0019
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "project_scouts",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("integration_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("tool_name", sa.String(), nullable=False),
        sa.Column("tool_arguments", JSONB(), nullable=False, server_default="{}"),
        sa.Column("objective", sa.Text(), nullable=False),
        sa.Column("interval_seconds", sa.Integer(), nullable=False, server_default="900"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_finding_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["integration_id"], ["integrations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_scouts_project_id", "project_scouts", ["project_id"])
    op.create_index("ix_project_scouts_integration_id", "project_scouts", ["integration_id"])


def downgrade():
    op.drop_index("ix_project_scouts_integration_id", table_name="project_scouts")
    op.drop_index("ix_project_scouts_project_id", table_name="project_scouts")
    op.drop_table("project_scouts")
