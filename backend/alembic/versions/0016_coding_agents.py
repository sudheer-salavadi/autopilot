"""Add coding-agent fix tracking to clusters and per-project agent config.

Supports the "Fix with Claude / Codex / Gemini" feature: a project opts a provider
in (project_agent_config), Autopilot posts a trigger comment on the filed GitHub
issue, and the resulting PR is linked back onto the cluster via webhook.

Revision ID: 0016
Revises: 0015
"""
import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("clusters", sa.Column("fix_provider", sa.String(), nullable=True))
    op.add_column(
        "clusters", sa.Column("fix_requested_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("clusters", sa.Column("fix_pr_number", sa.Integer(), nullable=True))
    op.add_column("clusters", sa.Column("fix_pr_url", sa.String(), nullable=True))
    op.add_column("clusters", sa.Column("fix_pr_state", sa.String(), nullable=True))

    op.create_table(
        "project_agent_config",
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("trigger_template", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("project_id", "provider"),
    )


def downgrade():
    op.drop_table("project_agent_config")
    op.drop_column("clusters", "fix_pr_state")
    op.drop_column("clusters", "fix_pr_url")
    op.drop_column("clusters", "fix_pr_number")
    op.drop_column("clusters", "fix_requested_at")
    op.drop_column("clusters", "fix_provider")
