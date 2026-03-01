"""add pm_insight to clusters

Revision ID: 0013
Revises: 0012
Create Date: 2026-03-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "clusters",
        sa.Column("pm_insight", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("clusters", "pm_insight")
