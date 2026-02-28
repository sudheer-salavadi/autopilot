"""Outbox-pattern evaluation queue.

Instead of fire-and-forget asyncio.create_task, webhook handlers write a row
to evaluation_jobs inside the same DB transaction that saves the event.  A
background worker polls the table and runs evaluate_project, so evaluations
survive process restarts and are guaranteed to run exactly once per batch of
arriving events.

Key design choices:
- One pending job per project: the partial unique index on (project_id) WHERE
  status='pending' plus INSERT … ON CONFLICT DO NOTHING prevents duplicates.
- Concurrency-safe claim: SELECT … FOR UPDATE SKIP LOCKED lets multiple workers
  (or future horizontal scaling) claim jobs without stepping on each other.
- Stuck job recovery: jobs in 'running' state older than 10 minutes are
  automatically re-queued on each worker iteration.
"""
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def enqueue_evaluation(project_id: uuid.UUID, db: AsyncSession) -> None:
    """Queue an evaluation job for this project within the caller's transaction.

    Must be called *before* db.commit() so the job and the triggering events
    are written atomically.  If a pending job already exists for this project,
    this is a silent no-op (de-duplication via partial unique index).
    """
    await db.execute(
        text(
            "INSERT INTO evaluation_jobs (project_id) VALUES (:pid) "
            "ON CONFLICT DO NOTHING"
        ),
        {"pid": str(project_id)},
    )


async def process_next_job(db: AsyncSession) -> bool:
    """Claim and run the oldest pending evaluation job.

    Returns True when a job was found and processed (success or failure).
    Returns False when the queue is empty — caller should back off.
    """
    from app.services.evaluator import evaluate_project

    # Reclaim stuck jobs: claimed but not finished within 10 minutes means the
    # worker process crashed.  Put them back in the queue.
    await db.execute(text("""
        UPDATE evaluation_jobs
           SET status = 'pending', claimed_at = NULL
         WHERE status  = 'running'
           AND claimed_at < NOW() - INTERVAL '10 minutes'
    """))
    await db.commit()

    # Atomically claim one job using SKIP LOCKED so concurrent workers don't
    # race.  The CTE + UPDATE … RETURNING is the standard PostgreSQL pattern.
    result = await db.execute(text("""
        UPDATE evaluation_jobs
           SET status = 'running', claimed_at = NOW()
         WHERE id = (
               SELECT id
                 FROM evaluation_jobs
                WHERE status = 'pending'
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
               )
         RETURNING id, project_id
    """))
    await db.commit()

    row = result.fetchone()
    if not row:
        return False

    job_id = row.id
    project_id = uuid.UUID(str(row.project_id))

    try:
        await evaluate_project(project_id, db)
        await db.execute(
            text("UPDATE evaluation_jobs SET status='done', done_at=NOW() WHERE id=:id"),
            {"id": str(job_id)},
        )
        await db.commit()
    except Exception as exc:
        await db.rollback()
        await db.execute(
            text(
                "UPDATE evaluation_jobs "
                "SET status='failed', error=:err WHERE id=:id"
            ),
            {"id": str(job_id), "err": str(exc)[:500]},
        )
        await db.commit()

    return True


async def cleanup_old_jobs(db: AsyncSession) -> None:
    """Delete done/failed jobs older than 24 hours to keep the table small."""
    await db.execute(text("""
        DELETE FROM evaluation_jobs
         WHERE status IN ('done', 'failed')
           AND created_at < NOW() - INTERVAL '24 hours'
    """))
    await db.commit()
