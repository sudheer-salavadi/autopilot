"""FullStory source plugin.

Real FullStory webhook schema (confirmed via API):
  {
    "eventName": "<event_name>",   ← top-level, NOT "name"
    "version": 1,
    "data": {
      "pageInfo": { "pageUrl": "...", "referrer": "...", "country": "..." },
      "sessionUrl": "https://app.fullstory.com/ui/ORG/session/<id>",
      "userUrl":    "https://app.fullstory.com/ui/ORG/.../user/<userId>",
      // developer custom properties from FS.event() — e.g.:
      "frustration_type": "rage_click" | "dead_click" | "error_click" | "thrash",
      "user_email": "<email>",
      "user_id":    "<app_user_id>",
      "target_text": "<element text>",
      "click_count": <int>
    }
  }

pageInfo.pageUrl and sessionUrl/userUrl are FullStory system fields present on every event.
Custom properties (frustration_type, user_email, etc.) are developer-defined via FS.event().
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


def _data(payload: dict) -> dict:
    """Return the data dict — real FullStory always wraps fields under 'data'."""
    return payload.get("data") or {}


def _page_url(payload: dict) -> str:
    """Extract page URL. Real FullStory: data.pageInfo.pageUrl (system field, always present).
    Also check data.page_url for developer custom property fallback."""
    d = _data(payload)
    page_info_url = (d.get("pageInfo") or {}).get("pageUrl", "")
    return str(page_info_url or d.get("page_url") or "")


def _user_identity(payload: dict) -> str:
    """Extract user email or ID. Prefers developer-set custom properties (data.user_email /
    data.user_id), falls back to parsing the FullStory userUrl path for the internal user ID."""
    d = _data(payload)
    # Developer custom properties — most useful for cross-source correlation
    email = str(d.get("user_email") or d.get("email") or "")
    if email:
        return email
    uid = str(d.get("user_id") or "")
    if uid:
        return uid
    # FullStory system field: userUrl ends with /user/<userId>
    user_url = str(d.get("userUrl") or "")
    if user_url:
        try:
            parts = urlparse(user_url).path.rstrip("/").split("/")
            return parts[-1] if parts else ""
        except Exception:
            pass
    return ""


def _summarize(event: Event, cross_channel: bool = True) -> str:
    payload = event.payload
    d = _data(payload)
    frustration = d.get("frustration_type") or event.event_type or "none"
    if cross_channel:
        page_url = _page_url(payload) or "unknown"
        user = _user_identity(payload) or "unknown"
        return f"{event.event_type} | frustration:{frustration} | page:{page_url} | user:{user}"
    page_url = _page_url(payload)
    try:
        path = urlparse(page_url).path or "unknown"
    except Exception:
        path = "unknown"
    return f"{event.event_type} | frustration:{frustration} | path:{path}"


def _ux_signal(event: Event) -> float:
    d = _data(event.payload)
    frustration = str(d.get("frustration_type") or event.event_type or "")
    return _FRUSTRATION_SCORES.get(frustration, 0.3)


def _rich_line(event: Event) -> str:
    payload = event.payload
    d = _data(payload)
    parts = [event.event_type]
    frustration = str(d.get("frustration_type") or "")
    page_url = _page_url(payload)
    target_text = str(d.get("target_text") or "")
    if frustration:
        parts.append(f"type={frustration}")
    if page_url:
        parts.append(f"page={page_url}")
    if target_text:
        parts.append(f'element="{target_text}"')
    return "  - " + " | ".join(parts)


def _is_negative(event: Event) -> bool:
    if event.event_type in _SESSION_EVENTS:
        return False
    d = _data(event.payload)
    frustration = (str(d.get("frustration_type") or event.event_type or "")).lower()
    return frustration not in ("", "none")


register(SourcePlugin(
    name="fullstory",
    summarize=_summarize,
    ux_signal=_ux_signal,
    rich_line=_rich_line,
    is_negative=_is_negative,
))
