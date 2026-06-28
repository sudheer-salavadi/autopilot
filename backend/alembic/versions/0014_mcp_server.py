"""add mcp_server to IntegrationType enum

Revision ID: 0014
Revises: 0013
Create Date: 2026-06-28
"""
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE integrationtype ADD VALUE IF NOT EXISTS 'mcp_server'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values without a full type rebuild
    pass
