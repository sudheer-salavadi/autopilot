"""Zendesk source plugin.

Handles support ticket creation and updates.  Ticket priority drives the UX
score so high-urgency tickets pull cluster scores up.  Solved/closed tickets
are treated as positive events and excluded from clustering.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from app.services.sources.registry import SourcePlugin, register

if TYPE_CHECKING:
    from app.models.event import Event

# Map Zendesk ticket priority → UX friction score (0–1)
_PRIORITY_SCORES: dict[str, float] = {
    "urgent": 0.95,
    "high":   0.75,
    "normal": 0.50,
    "low":    0.25,
}

_RESOLVED_STATUSES: frozenset[str] = frozenset({"solved", "closed"})

# Same statuses as a SQL IN () fragment for the evaluator's SQL prefilter —
# must stay in sync with is_negative below or resolved tickets pile up
# unclustered and starve the evaluation batch.
RESOLVED_STATUS_SQL: str = ", ".join(f"'{s}'" for s in sorted(_RESOLVED_STATUSES))


def _summarize(event: Event, cross_channel: bool = True) -> str:
    # Real Zendesk schema: event fields live in payload["detail"] (flat object)
    detail   = event.payload.get("detail", {}) or {}
    priority = (detail.get("priority") or "normal").lower()
    status   = detail.get("status", "open")
    subject  = (detail.get("subject") or "")[:60]

    if cross_channel:
        # external_id is the developer-set app user_id — the real cross-source hook.
        # Fall back to requester_id (Zendesk-internal) if external_id isn't set.
        identity = detail.get("external_id") or f"zd:{detail.get('requester_id', 'unknown')}"
        return (
            f"zendesk_ticket | priority:{priority} | status:{status} "
            f"| requester:{identity} | subject:{subject}"
        )
    return f"zendesk_ticket | priority:{priority} | subject:{subject}"


def _ux_signal(event: Event) -> float:
    priority = ((event.payload.get("detail", {}) or {}).get("priority") or "normal").lower()
    return _PRIORITY_SCORES.get(priority, 0.50)


def _rich_line(event: Event) -> str:
    detail      = event.payload.get("detail", {}) or {}
    subject     = (detail.get("subject") or "")[:80]
    priority    = (detail.get("priority") or "normal").lower()
    status      = (detail.get("status") or "open").lower()
    external_id = detail.get("external_id") or ""

    parts = [f"zendesk:{event.event_type}", f"priority={priority}", f"status={status}"]
    if subject:
        parts.append(f'subject="{subject}"')
    if external_id:
        parts.append(f"user={external_id}")
    return "  - " + " | ".join(parts)


def _is_negative(event: Event) -> bool:
    status = ((event.payload.get("detail", {}) or {}).get("status") or "").lower()
    return status not in _RESOLVED_STATUSES


def _identity(event: Event) -> str:
    detail = event.payload.get("detail", {}) or {}
    external_id = detail.get("external_id")
    if external_id:
        return str(external_id)
    requester_id = detail.get("requester_id")
    return f"zd:{requester_id}" if requester_id else ""


register(SourcePlugin(
    name="zendesk",
    summarize=_summarize,
    ux_signal=_ux_signal,
    rich_line=_rich_line,
    is_negative=_is_negative,
    identity=_identity,
))
