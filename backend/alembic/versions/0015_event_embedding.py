"""add embedding column to events table

Revision ID: 0015
Revises: 0014
Create Date: 2026-06-28
"""
from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE events ADD COLUMN IF NOT EXISTS embedding vector(1536)")
    # Index for fast nearest-neighbour lookup when finding candidate clusters
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_events_embedding "
        "ON events USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_events_embedding")
    op.execute("ALTER TABLE events DROP COLUMN IF EXISTS embedding")
