"""Make the embedding vector dimension deployment-configurable.

Previously both events.embedding and clusters.embedding were hardcoded to
vector(1536) (OpenAI's text-embedding-3-small). BYO-model deployments may
point AI_EMBEDDING_MODEL at a local embedding model with a different output
dimension (e.g. Ollama's nomic-embed-text is 768-dim), so the column
dimension now follows settings.AI_EMBEDDING_DIMS.

If AI_EMBEDDING_DIMS is still the default (1536) when this migration runs,
it's a no-op — the column already matches. If it's been changed, existing
embeddings are cleared (they're the wrong dimension for the new model
anyway) and events/clusters fall back to the LLM clustering path until
re-embedded on the next evaluation pass.

Changing AI_EMBEDDING_DIMS again *after* this migration has run requires a
manual ALTER — Alembic migrations don't re-run when config changes. See
docs/platform-vision.md.

Revision ID: 0018
Revises: 0017
"""
from alembic import op

from app.config import settings

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None

_PREVIOUS_DIMS = 1536


def _resize(dims: int) -> None:
    op.execute("DROP INDEX IF EXISTS clusters_embedding_hnsw")
    op.execute("DROP INDEX IF EXISTS ix_events_embedding")
    op.execute("UPDATE clusters SET embedding = NULL")
    op.execute("UPDATE events SET embedding = NULL")
    op.execute(f"ALTER TABLE clusters ALTER COLUMN embedding TYPE vector({dims})")
    op.execute(f"ALTER TABLE events ALTER COLUMN embedding TYPE vector({dims})")
    op.execute(
        "CREATE INDEX IF NOT EXISTS clusters_embedding_hnsw "
        "ON clusters USING hnsw (embedding vector_cosine_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_events_embedding "
        "ON events USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
    )


def upgrade() -> None:
    dims = settings.AI_EMBEDDING_DIMS
    if dims == _PREVIOUS_DIMS:
        return
    _resize(dims)


def downgrade() -> None:
    dims = settings.AI_EMBEDDING_DIMS
    if dims == _PREVIOUS_DIMS:
        return
    _resize(_PREVIOUS_DIMS)
