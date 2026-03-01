"""Switch GitHub integration from PAT to GitHub App installation_id.

Drops the encrypted token and webhook_secret columns from project_github_config
and adds an installation_id (BIGINT) column.  The installation_id is obtained
via the GitHub App OAuth flow and is not sensitive, so no encryption needed.

Revision ID: 0011
Revises: 0010
"""
import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column("project_github_config", "token")
    op.drop_column("project_github_config", "webhook_secret")
    op.add_column(
        "project_github_config",
        sa.Column("installation_id", sa.BigInteger(), nullable=True),
    )


def downgrade():
    op.drop_column("project_github_config", "installation_id")
    op.add_column(
        "project_github_config",
        sa.Column("webhook_secret", sa.String(), nullable=True),
    )
    op.add_column(
        "project_github_config",
        sa.Column("token", sa.String(), nullable=True),
    )
