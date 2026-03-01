"""Stripe MCP-mode event puller.

Instead of receiving Stripe webhooks, poll the Stripe API directly for recent
negative events (failed payments, disputes, past-due invoices).

Converts API objects to Event records using the same payload structure as
webhooks so the existing Stripe source plugin (sources/stripe.py) processes
them correctly without modification.
"""
import asyncio
import uuid
from datetime import datetime, timezone, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event

# How far back to look on each sync cycle
_LOOKBACK_HOURS = 24


def _to_dict(obj) -> dict:
    """Convert a Stripe SDK object to a plain dict."""
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    return dict(obj)


def _fetch_stripe_failures(api_key: str, since_ts: int) -> list[dict]:
    """Synchronous Stripe API calls — run via asyncio.to_thread.

    Returns a list of webhook-style payloads for negative signals:
    - Failed / canceled PaymentIntents with a last_payment_error
    - Failed Charges
    - Open Disputes (needs_response)
    - Past-due Invoices
    """
    import stripe

    client = stripe.StripeClient(api_key)
    results: list[dict] = []

    # ── Failed PaymentIntents ────────────────────────────────────────────────
    try:
        pis = client.payment_intents.list(
            params={"limit": 50, "created": {"gte": since_ts}}
        )
        for pi in pis.data:
            pi_dict = _to_dict(pi)
            if pi_dict.get("status") in (
                "requires_payment_method",
                "canceled",
            ) and pi_dict.get("last_payment_error"):
                results.append(
                    {
                        "type": "payment_intent.payment_failed",
                        "data": {"object": pi_dict},
                        "_mcp": True,
                    }
                )
    except Exception:
        pass

    # ── Failed Charges ───────────────────────────────────────────────────────
    try:
        charges = client.charges.list(
            params={"limit": 50, "created": {"gte": since_ts}}
        )
        for ch in charges.data:
            ch_dict = _to_dict(ch)
            if ch_dict.get("status") == "failed":
                results.append(
                    {
                        "type": "charge.failed",
                        "data": {"object": ch_dict},
                        "_mcp": True,
                    }
                )
    except Exception:
        pass

    # ── Open Disputes ────────────────────────────────────────────────────────
    try:
        disputes = client.disputes.list(
            params={"limit": 20, "created": {"gte": since_ts}}
        )
        for d in disputes.data:
            d_dict = _to_dict(d)
            if d_dict.get("status") in (
                "needs_response",
                "warning_needs_response",
                "under_review",
            ):
                results.append(
                    {
                        "type": "charge.dispute.created",
                        "data": {"object": d_dict},
                        "_mcp": True,
                    }
                )
    except Exception:
        pass

    # ── Past-due Invoices ────────────────────────────────────────────────────
    try:
        invoices = client.invoices.list(
            params={"limit": 50, "status": "past_due"}
        )
        for inv in invoices.data:
            inv_dict = _to_dict(inv)
            # Only include if created within the lookback window
            if inv_dict.get("created", 0) >= since_ts:
                results.append(
                    {
                        "type": "invoice.payment_failed",
                        "data": {"object": inv_dict},
                        "_mcp": True,
                    }
                )
    except Exception:
        pass

    return results


async def pull_stripe_events(
    api_key: str,
    project_id: uuid.UUID,
    integration_id: uuid.UUID,
    db: AsyncSession,
    since_hours: int = _LOOKBACK_HOURS,
) -> int:
    """Fetch recent Stripe failures and insert them as Event records.

    Deduplicates against existing events by Stripe object ID so re-running
    the same sync window never double-inserts.

    Returns the count of newly-inserted events.
    Raises ValueError on authentication / API errors.
    """
    import stripe

    since_ts = int(
        (datetime.now(timezone.utc) - timedelta(hours=since_hours)).timestamp()
    )

    try:
        raw_events = await asyncio.to_thread(
            _fetch_stripe_failures, api_key, since_ts
        )
    except stripe.AuthenticationError:
        raise ValueError("Invalid Stripe API key")
    except Exception as exc:
        raise ValueError(f"Stripe API error: {exc}") from exc

    if not raw_events:
        return 0

    # Collect Stripe object IDs present in this batch for deduplication
    candidate_ids = [
        e["data"]["object"].get("id")
        for e in raw_events
        if e["data"]["object"].get("id")
    ]

    already_stored: set[str] = set()
    if candidate_ids:
        result = await db.execute(
            text(
                """
                SELECT payload->'data'->'object'->>'id' AS stripe_id
                  FROM events
                 WHERE project_id = :project_id
                   AND source      = 'stripe'
                   AND payload->'data'->'object'->>'id' = ANY(:ids)
                """
            ),
            {"project_id": str(project_id), "ids": candidate_ids},
        )
        already_stored = {row.stripe_id for row in result}

    inserted = 0
    now = datetime.now(timezone.utc)

    for raw in raw_events:
        obj_id = raw["data"]["object"].get("id", "")
        if obj_id in already_stored:
            continue

        db.add(
            Event(
                project_id=project_id,
                integration_id=integration_id,
                source="stripe",
                event_type=raw["type"],
                payload=raw,
                is_demo=False,
                received_at=now,
            )
        )
        already_stored.add(obj_id)  # prevent dupes within the same batch
        inserted += 1

    if inserted:
        await db.flush()

    return inserted
