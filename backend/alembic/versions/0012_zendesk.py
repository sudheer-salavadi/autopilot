"""Add Zendesk integration type and simulation flag.

Revision ID: 0012
Revises: 0011
"""
import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL requires an explicit ALTER TYPE to add enum values
    op.execute("ALTER TYPE integrationtype ADD VALUE IF NOT EXISTS 'zendesk'")

    # Allow simulate_zendesk flag on scoring config
    op.add_column(
        "project_scoring_config",
        sa.Column(
            "simulate_zendesk",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("project_scoring_config", "simulate_zendesk")
    # PostgreSQL does not support removing enum values — leave the type as-is
