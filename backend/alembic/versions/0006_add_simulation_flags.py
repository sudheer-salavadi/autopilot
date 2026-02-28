"""add simulation flags to project_scoring_config

Revision ID: 0006
Revises: 0005
Create Date: 2025-01-06 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "project_scoring_config",
        sa.Column("simulate_stripe", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "project_scoring_config",
        sa.Column("simulate_sentry", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "project_scoring_config",
        sa.Column("simulate_fullstory", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("project_scoring_config", "simulate_fullstory")
    op.drop_column("project_scoring_config", "simulate_sentry")
    op.drop_column("project_scoring_config", "simulate_stripe")
