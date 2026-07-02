"""Sentry source plugin.

Handles issue.created, issue.assigned, error events etc.
Resolved/ignored issues and info-level events are excluded from clustering.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from app.services.sources.registry import SourcePlugin, register

if TYPE_CHECKING:
    from app.models.event import Event


def _summarize(event: Event, cross_channel: bool = True) -> str:
    p = event.payload
    data = p.get("data", {})
    evt = data.get("event", {})
    exc_values = evt.get("exception", {}).get("values", [{}])
    # Sentry chains exceptions innermost-last; [-1] is the root cause, [0] is the wrapper
    exc_type = exc_values[-1].get("type", "unknown") if exc_values else "unknown"
    level = data.get("issue", {}).get("level", evt.get("level", "error"))
    if cross_channel:
        user_email = evt.get("user", {}).get("email", "unknown")
        return f"{event.event_type} | error:{exc_type} | user:{user_email} | level:{level}"
    return f"{event.event_type} | error:{exc_type} | level:{level}"


def _ux_signal(event: Event) -> float:
    data = event.payload.get("data", {})
    level = data.get("issue", {}).get("level", data.get("event", {}).get("level", "error"))
    return {"error": 0.8, "warning": 0.4, "info": 0.1}.get(level, 0.5)


def _rich_line(event: Event) -> str:
    p = event.payload
    data = p.get("data", {})
    evt = data.get("event", {})
    exc_values = evt.get("exception", {}).get("values", [{}])
    exc = exc_values[-1] if exc_values else {}  # root cause, not outermost wrapper
    parts = [event.event_type]
    exc_type = exc.get("type", "")
    exc_value = exc.get("value", "")
    issue_title = data.get("issue", {}).get("title", "")
    culprit = evt.get("culprit", "")
    req_url = evt.get("request", {}).get("url", "")
    level = data.get("issue", {}).get("level", evt.get("level", ""))
    if exc_type:
        parts.append(f"error={exc_type}")
    if exc_value and len(exc_value) < 100:
        parts.append(f'msg="{exc_value}"')
    if issue_title and issue_title != exc_type:
        parts.append(f'title="{issue_title}"')
    if culprit:
        parts.append(f"culprit={culprit}")
    if req_url:
        parts.append(f"url={req_url}")
    if level and level not in ("error", ""):
        parts.append(f"level={level}")
    return "  - " + " | ".join(parts)


def _is_negative(event: Event) -> bool:
    if event.event_type in ("issue.resolved", "issue.ignored"):
        return False
    action = event.payload.get("action", "")
    if action in ("resolved", "ignored"):
        return False
    data = event.payload.get("data", {})
    level = data.get("issue", {}).get("level", data.get("event", {}).get("level", "error"))
    return level not in ("info", "unknown")


def _identity(event: Event) -> str:
    evt = event.payload.get("data", {}).get("event", {})
    return str(evt.get("user", {}).get("email") or "")


register(SourcePlugin(
    name="sentry",
    summarize=_summarize,
    ux_signal=_ux_signal,
    rich_line=_rich_line,
    is_negative=_is_negative,
    identity=_identity,
))
