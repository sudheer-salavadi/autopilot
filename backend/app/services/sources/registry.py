"""Source plugin registry.

Each event source (Stripe, Sentry, FullStory, …) registers a SourcePlugin
that encapsulates all evaluation logic for that source.  Adding a new source
only requires creating a new plugin module and importing it so it self-registers.

Usage
-----
    from app.services.sources import registry

    plugin = registry.get("stripe")   # → SourcePlugin | None
    signal = plugin.ux_signal(event) if plugin else 0.3
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from app.models.event import Event

_registry: dict[str, "SourcePlugin"] = {}


@dataclass
class SourcePlugin:
    """All evaluation-time logic for a single event source."""

    name: str

    # Compact text summary for LLM cluster-assignment context
    summarize: Callable[["Event", bool], str]  # (event, cross_channel) -> str

    # 0–1 UX friction score for a single event
    ux_signal: Callable[["Event"], float]

    # Detailed, element/page-aware description used in _regenerate_insight
    rich_line: Callable[["Event"], str]

    # True only for events that represent a problem worth clustering
    is_negative: Callable[["Event"], bool]


def register(plugin: SourcePlugin) -> None:
    """Register a source plugin.  Called at import time by each source module."""
    _registry[plugin.name] = plugin


def get(source: str) -> SourcePlugin | None:
    """Return the plugin for *source*, or None if unrecognised."""
    return _registry.get(source)


def registered_sources() -> list[str]:
    """Names of all registered sources."""
    return list(_registry.keys())
