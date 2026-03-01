"""Source plugin package.

Importing this package registers all built-in source plugins.  To add a new
source (e.g. Datadog, Statsig) create a module in this directory, implement
the four SourcePlugin functions, and add an import below.

The evaluator imports `app.services.sources` at startup so all plugins are
registered before any event is processed.
"""
# Built-in source plugins — import triggers self-registration via register()
from app.services.sources import fullstory, sentry, stripe, zendesk  # noqa: F401
from app.services.sources.registry import get, register, registered_sources  # noqa: F401

__all__ = ["get", "register", "registered_sources"]
