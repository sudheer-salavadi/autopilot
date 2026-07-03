"""Audit recording — one call per outward-facing or admin action.

record() adds a row to the caller's session/transaction, so an audit entry
commits atomically with the action it describes and is rolled back with it.
It never raises: an audit failure must not break the action being audited.
"""
import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.models.user import User

logger = logging.getLogger(__name__)

# Actor email used for actions Autopilot takes on its own (auto-filed issues)
SYSTEM_ACTOR = "autopilot"


def record(
    db: AsyncSession,
    *,
    action: str,
    actor: User | None = None,
    actor_email: str | None = None,
    project_id: uuid.UUID | None = None,
    target_type: str | None = None,
    target_id: uuid.UUID | str | None = None,
    summary: str = "",
) -> None:
    """Append an audit entry to the current transaction (fire-and-forget)."""
    try:
        db.add(AuditLog(
            project_id=project_id,
            actor_id=actor.id if actor else None,
            actor_email=(actor.email if actor else actor_email) or "",
            action=action,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            summary=summary[:500],
        ))
    except Exception:
        logger.warning("Failed to record audit entry action=%s", action, exc_info=True)
