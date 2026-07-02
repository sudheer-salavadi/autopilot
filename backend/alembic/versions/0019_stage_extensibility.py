"""Make pipeline stages independently addressable: outbound webhooks + pluggable scoring.

Adds project_webhook_subscriptions (third parties subscribe to stage-transition
events — cluster.created, cluster.scored, cluster.issue_filed, cluster.fix_requested,
cluster.fix_pr_linked, cluster.resolved — instead of polling) and a scoring override
webhook on project_scoring_config (a custom scoring plugin can replace the internal
revenue/frequency/ux formula for a project).

Revision ID: 0019
Revises: 0018
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "project_webhook_subscriptions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("url", sa.String(), nullable=False),
        sa.Column("secret", sa.String(), nullable=False),
        sa.Column("event_types", JSONB(), nullable=False, server_default="[]"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_delivery_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_delivery_status", sa.Integer(), nullable=True),
        sa.Column("last_delivery_error", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_project_webhook_subscriptions_project_id",
        "project_webhook_subscriptions",
        ["project_id"],
    )

    op.add_column(
        "project_scoring_config", sa.Column("scoring_webhook_url", sa.String(), nullable=True)
    )
    op.add_column(
        "project_scoring_config", sa.Column("scoring_webhook_secret", sa.String(), nullable=True)
    )


def downgrade():
    op.drop_column("project_scoring_config", "scoring_webhook_secret")
    op.drop_column("project_scoring_config", "scoring_webhook_url")
    op.drop_index(
        "ix_project_webhook_subscriptions_project_id",
        table_name="project_webhook_subscriptions",
    )
    op.drop_table("project_webhook_subscriptions")
