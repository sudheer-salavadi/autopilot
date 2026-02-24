"""add fullstory integration type

Revision ID: 0003
Revises: 0002
Create Date: 2025-01-03 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ALTER TYPE ADD VALUE cannot run inside a transaction block in PG < 12.
    # COMMIT ends the implicit transaction so the statement runs in autocommit mode.
    op.execute("COMMIT")
    op.execute("ALTER TYPE integrationtype ADD VALUE IF NOT EXISTS 'fullstory'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; downgrade is a no-op.
    pass
