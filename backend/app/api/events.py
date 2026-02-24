from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_project_member
from app.db.session import get_db
from app.models.event import Event
from app.schemas.event import EventOut, EventsPage

router = APIRouter(prefix="/api/projects/{slug}/events", tags=["events"])


@router.get("", response_model=EventsPage)
async def list_events(
    deps=Depends(require_project_member),
    db: AsyncSession = Depends(get_db),
    source: str | None = Query(default=None),
    event_type: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
):
    project, _, __ = deps

    base = select(Event).where(Event.project_id == project.id)
    if source:
        base = base.where(Event.source == source)
    if event_type:
        base = base.where(Event.event_type == event_type)

    count_result = await db.execute(select(func.count()).select_from(base.subquery()))
    total = count_result.scalar_one()

    items_result = await db.execute(
        base.order_by(Event.received_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = items_result.scalars().all()

    return EventsPage(items=items, total=total, page=page, page_size=page_size)
