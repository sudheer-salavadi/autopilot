"""add project_github_config table

Revision ID: 0008
Revises: 0007
Create Date: 2025-01-08 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_github_config",
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("repo", sa.String(), nullable=True),          # "owner/repo"
        sa.Column("token", sa.String(), nullable=True),          # Fernet-encrypted PAT
        sa.Column("autopilot_enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("autopilot_min_score", sa.Float(), nullable=False, server_default="0.7"),
        sa.ForeignKeyConstraint(
            ["project_id"], ["projects.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("project_id"),
    )


def downgrade() -> None:
    op.drop_table("project_github_config")
