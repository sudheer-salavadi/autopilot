"""FullStory source plugin.

Handles rage clicks, dead clicks, error clicks, and other frustration signals.
Session lifecycle events and no-frustration events are not clustered.
"""
from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import urlparse

from app.services.sources.registry import SourcePlugin, register

if TYPE_CHECKING:
    from app.models.event import Event

_FRUSTRATION_SCORES: dict[str, float] = {
    "rage_click": 1.0,
    "error_click": 0.85,
    "dead_click": 0.7,
    "thrash": 0.6,
}

_SESSION_EVENTS: frozenset[str] = frozenset({
    "session_start", "session_end", "session_url_changed",
})


def _summarize(event: Event, cross_channel: bool = True) -> str:
    data = event.payload.get("data", {})
    frustration = data.get("frustration_type", "none")
    if cross_channel:
        page_url = data.get("page_url", "unknown")
        user_email = data.get("user_email", "unknown")
        return f"{event.event_type} | frustration:{frustration} | page:{page_url} | user:{user_email}"
    # Strip URL to path only (drop query strings and IDs) for pattern clustering
    page_url = data.get("page_url", "")
    try:
        path = urlparse(page_url).path
    except Exception:
        path = "unknown"
    return f"{event.event_type} | frustration:{frustration} | path:{path}"


def _ux_signal(event: Event) -> float:
    frustration = event.payload.get("data", {}).get("frustration_type", "")
    return _FRUSTRATION_SCORES.get(frustration, 0.3)


def _rich_line(event: Event) -> str:
    data = event.payload.get("data", {})
    parts = [event.event_type]
    frustration = data.get("frustration_type", "")
    page_url = data.get("page_url", "")
    target_text = data.get("target_text", "") or data.get("element", {}).get("text", "")
    tag_name = data.get("element", {}).get("tag_name", "")
    if frustration:
        parts.append(f"type={frustration}")
    if page_url:
        parts.append(f"page={page_url}")
    if target_text:
        parts.append(f'element="{target_text}"')
    if tag_name:
        parts.append(f"tag={tag_name}")
    return "  - " + " | ".join(parts)


def _is_negative(event: Event) -> bool:
    if event.event_type in _SESSION_EVENTS:
        return False
    frustration = (event.payload.get("data", {}).get("frustration_type") or "").lower()
    return frustration not in ("", "none")


register(SourcePlugin(
    name="fullstory",
    summarize=_summarize,
    ux_signal=_ux_signal,
    rich_line=_rich_line,
    is_negative=_is_negative,
))
