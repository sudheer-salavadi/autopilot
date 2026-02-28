"""Stripe source plugin.

Handles payment_intent, charge, invoice, subscription, and related events.
Only negative signals (failures, refunds, disputes, past-due) are clustered;
successful payment activity is excluded.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

from app.services.sources.registry import SourcePlugin, register

if TYPE_CHECKING:
    from app.models.event import Event

# ── Constants ──────────────────────────────────────────────────────────────────

# Event types that represent normal positive activity.
# Used by the evaluator SQL filter (imported as POSITIVE_TYPES / POSITIVE_SQL)
# *and* by the Python is_negative check below.
POSITIVE_TYPES: frozenset[str] = frozenset({
    "payment_intent.succeeded",
    "payment_intent.created",
    "charge.succeeded",
    "charge.updated",
    "checkout.session.completed",
    "customer.created",
    "customer.updated",
    "customer.subscription.created",
    "invoice.created",
    "invoice.finalized",
    "invoice.sent",
    "invoice.paid",
    "invoice.payment_succeeded",
    "payment_method.attached",
    "setup_intent.succeeded",
    "setup_intent.created",
})

# Pre-formatted SQL IN () fragment — safe constant, not user input
POSITIVE_SQL: str = ", ".join(f"'{t}'" for t in sorted(POSITIVE_TYPES))

_POSITIVE_STATUSES: frozenset[str] = frozenset({
    "paid", "succeeded", "active", "trialing", "complete",
})

# ── Plugin functions ───────────────────────────────────────────────────────────

def _summarize(event: Event, cross_channel: bool = True) -> str:
    p = event.payload
    obj = p.get("data", {}).get("object", {})
    status = obj.get("status", "unknown")
    if cross_channel:
        cus = obj.get("customer", p.get("customer", "unknown"))
        amount = obj.get("amount", obj.get("amount_due", 0))
        return f"{event.event_type} | customer:{cus} | amount:{amount} | status:{status}"
    return f"{event.event_type} | status:{status}"


def _ux_signal(_event: Event) -> float:
    # Stripe is a revenue signal, not a UX frustration signal
    return 0.3


def _rich_line(event: Event) -> str:
    p = event.payload
    obj = p.get("data", {}).get("object", {})
    parts = [event.event_type]
    status = obj.get("status", "")
    amount = obj.get("amount", obj.get("amount_due", 0))
    failure_msg = obj.get("failure_message", obj.get("description", ""))
    if status:
        parts.append(f"status={status}")
    if amount:
        parts.append(f"${amount / 100:.2f}")
    if failure_msg:
        parts.append(f'reason="{failure_msg}"')
    return "  - " + " | ".join(parts)


def _is_negative(event: Event) -> bool:
    if event.event_type in POSITIVE_TYPES:
        return False
    obj = event.payload.get("data", {}).get("object", {})
    status = obj.get("status", "")
    if status in _POSITIVE_STATUSES:
        return False
    return True


# ── Registration ───────────────────────────────────────────────────────────────

register(SourcePlugin(
    name="stripe",
    summarize=_summarize,
    ux_signal=_ux_signal,
    rich_line=_rich_line,
    is_negative=_is_negative,
))
