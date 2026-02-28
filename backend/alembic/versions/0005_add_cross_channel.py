"""add cross_channel to project_scoring_config

Revision ID: 0005
Revises: 0004
Create Date: 2025-01-05 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "project_scoring_config",
        sa.Column("cross_channel", sa.Boolean(), nullable=False, server_default="true"),
    )


def downgrade() -> None:
    op.drop_column("project_scoring_config", "cross_channel")
