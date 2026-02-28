"""Add evaluation_jobs outbox table.

Replaces asyncio.create_task fire-and-forget with a persistent queue.
Jobs survive process restarts; stuck running jobs are reclaimed after 10 min.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "evaluation_jobs",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "project_id",
            UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # pending → running → done | failed
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.String(1000), nullable=True),
    )

    # Efficient poll: find oldest pending jobs quickly
    op.create_index(
        "ix_evaluation_jobs_status_created",
        "evaluation_jobs",
        ["status", "created_at"],
    )

    # Only one pending job per project at a time — INSERT ON CONFLICT DO NOTHING
    op.execute("""
        CREATE UNIQUE INDEX ix_evaluation_jobs_pending_project
            ON evaluation_jobs (project_id)
         WHERE (status = 'pending')
    """)


def downgrade():
    op.drop_table("evaluation_jobs")
