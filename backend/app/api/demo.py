import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_project_member
from app.db.session import AsyncSessionLocal, get_db
from app.models.event import Event
from app.services.demo import generate_demo_events

router = APIRouter()


class DemoRequest(BaseModel):
    source: str  # "stripe" or "sentry"


async def _trigger_evaluate(project_id: uuid.UUID) -> None:
    """Run evaluate_project in a fresh DB session (safe for background tasks)."""
    from app.services.evaluator import evaluate_project
    try:
        async with AsyncSessionLocal() as db:
            await evaluate_project(project_id, db)
    except Exception:
        pass


@router.post("/api/projects/{slug}/demo-ingest")
async def ingest_demo_events(
    body: DemoRequest,
    deps=Depends(require_project_member),
    db: AsyncSession = Depends(get_db),
):
    if body.source not in ("stripe", "sentry", "fullstory"):
        raise HTTPException(status_code=400, detail="source must be 'stripe', 'sentry', or 'fullstory'")

    project, _, _ = deps

    # Fetch recent events from the other source(s) for cross-source correlation
    other_sources = [s for s in ("stripe", "sentry", "fullstory") if s != body.source]
    result = await db.execute(
        select(Event)
        .where(Event.project_id == project.id, Event.source.in_(other_sources))
        .order_by(Event.received_at.desc())
        .limit(3)
    )
    context_events = [
        {"source": e.source, "event_type": e.event_type, "payload": e.payload}
        for e in result.scalars().all()
    ]

    try:
        events_data = await generate_demo_events(
            source=body.source,
            context_events=context_events or None,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI generation failed: {str(e)}")

    received_at = datetime.now(timezone.utc)
    for e in events_data:
        db.add(
            Event(
                id=uuid.uuid4(),
                project_id=project.id,
                integration_id=None,
                source=e.get("source", body.source),
                event_type=e.get("event_type", "demo.event"),
                payload=e.get("payload", {}),
                is_demo=True,
                received_at=received_at,
            )
        )

    await db.commit()
    asyncio.create_task(_trigger_evaluate(project.id))
    return {"inserted": len(events_data)}
