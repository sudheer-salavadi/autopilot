"""add pgvector embeddings, regression tracking, and github issue fields to clusters

Revision ID: 0007
Revises: 0006
Create Date: 2025-01-07 00:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # Embedding column — 1536 dims matches text-embedding-3-small
    op.execute("ALTER TABLE clusters ADD COLUMN embedding vector(1536)")

    # HNSW index for cosine similarity — works well at any dataset size
    op.execute(
        "CREATE INDEX IF NOT EXISTS clusters_embedding_hnsw "
        "ON clusters USING hnsw (embedding vector_cosine_ops)"
    )

    # Regression tracking
    op.add_column(
        "clusters",
        sa.Column("parent_cluster_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_clusters_parent_cluster",
        "clusters",
        "clusters",
        ["parent_cluster_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "clusters",
        sa.Column(
            "regression_count", sa.Integer(), nullable=False, server_default="0"
        ),
    )

    # GitHub issue fields
    op.add_column(
        "clusters", sa.Column("github_issue_number", sa.Integer(), nullable=True)
    )
    op.add_column(
        "clusters", sa.Column("github_issue_url", sa.String(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("clusters", "github_issue_url")
    op.drop_column("clusters", "github_issue_number")
    op.drop_constraint(
        "fk_clusters_parent_cluster", "clusters", type_="foreignkey"
    )
    op.drop_column("clusters", "regression_count")
    op.drop_column("clusters", "parent_cluster_id")
    op.execute("DROP INDEX IF EXISTS clusters_embedding_hnsw")
    op.execute("ALTER TABLE clusters DROP COLUMN IF EXISTS embedding")
