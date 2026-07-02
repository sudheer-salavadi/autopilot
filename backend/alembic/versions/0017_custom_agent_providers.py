"""Allow projects to define custom coding-agent providers, not just the
Claude/Codex/Gemini built-ins.

Adds name/setup_docs_url (override or, for custom rows, the only source of
truth) and is_custom (drives whether a row can be deleted vs. only disabled)
to project_agent_config.

Revision ID: 0017
Revises: 0016
"""
import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("project_agent_config", sa.Column("name", sa.String(), nullable=True))
    op.add_column(
        "project_agent_config", sa.Column("setup_docs_url", sa.String(), nullable=True)
    )
    op.add_column(
        "project_agent_config",
        sa.Column("is_custom", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column("project_agent_config", "is_custom")
    op.drop_column("project_agent_config", "setup_docs_url")
    op.drop_column("project_agent_config", "name")
