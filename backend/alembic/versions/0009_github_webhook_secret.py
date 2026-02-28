"""add webhook_secret to project_github_config

Revision ID: 0009
Revises: 0008
Create Date: 2025-01-09 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Encrypted webhook secret used to verify inbound GitHub webhook payloads
    op.add_column(
        "project_github_config",
        sa.Column("webhook_secret", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("project_github_config", "webhook_secret")
