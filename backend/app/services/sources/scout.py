"""Scout source plugin.

Every "scout" event was already judged notable by the LLM evaluation step in
services/scouts.py before it was created — unlike other sources, there's no
"routine/positive" case to filter out here, so is_negative is always True.
Severity comes straight from that same evaluation, not recomputed here.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from app.services.sources.registry import SourcePlugin, register

if TYPE_CHECKING:
    from app.models.event import Event

# Scout severity is the LLM's own self-assessment of its finding — unlike
# Zendesk's priority (set by a human) or FullStory's frustration type (an
# observed behavior), there is no objective figure grounding it. The scale is
# therefore deliberately discounted so an uncorroborated "critical" (0.75)
# stays below a human-set Zendesk urgent (0.95), an observed rage_click (1.0),
# and a Sentry error (0.8) — a scout finding raises priority, it doesn't
# dominate it. If corroborating events from evidence-backed sources join the
# cluster, they carry the ux_score instead (it aggregates by max).
_SEVERITY_SCORES: dict[str, float] = {
    "critical": 0.75,
    "high": 0.60,
    "medium": 0.40,
    "low": 0.20,
}


def _summarize(event: Event, cross_channel: bool = True) -> str:
    p = event.payload or {}
    return (
        f"scout:{p.get('scout_name', event.event_type)} "
        f"| severity:{p.get('severity', 'medium')} "
        f"| {p.get('summary', '')}"
    )


def _ux_signal(event: Event) -> float:
    severity = (event.payload or {}).get("severity", "medium")
    return _SEVERITY_SCORES.get(severity, 0.50)


def _rich_line(event: Event) -> str:
    p = event.payload or {}
    parts = [
        f"scout:{p.get('scout_name', event.event_type)}",
        f"severity={p.get('severity', 'medium')}",
    ]
    if p.get("summary"):
        parts.append(f'summary="{p["summary"]}"')
    if p.get("details"):
        parts.append(f'details="{p["details"]}"')
    return "  - " + " | ".join(parts)


def _is_negative(event: Event) -> bool:
    # A scout only ever creates an event when its own LLM evaluation step
    # already decided the result was notable — nothing further to filter.
    return True


# No identity function: a scout finding is an aggregate observation about the
# product (e.g. "signup conversion dropped 40%"), not an event tied to one
# user — it has no per-user identity to contribute to affected_users.

register(SourcePlugin(
    name="scout",
    summarize=_summarize,
    ux_signal=_ux_signal,
    rich_line=_rich_line,
    is_negative=_is_negative,
))
