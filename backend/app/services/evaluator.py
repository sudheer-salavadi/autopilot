"""
Correlation & Prioritization Engine.

Groups raw events into clusters (same root cause) and scores each cluster
using a weighted formula: Score = Revenue*w1 + Frequency*w2 + UX*w3
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import AsyncSessionLocal
from app.models.cluster import Cluster, ClusterEvent
from app.models.event import Event
from app.models.scoring_config import ProjectScoringConfig
from app.services.demo import _ai_client, _parse_json

# Stripe event types that represent normal positive activity — not problems.
# These are excluded from clustering so the engine focuses on issues.
_POSITIVE_STRIPE_TYPES = frozenset({
    "payment_intent.succeeded",
    "payment_intent.created",
    "charge.succeeded",
    "charge.updated",
    "checkout.session.completed",
    "customer.created",
    "customer.updated",
    "customer.subscription.created",
    "customer.subscription.updated",
    "invoice.created",
    "invoice.finalized",
    "invoice.sent",
    "invoice.payment_succeeded",
    "payment_method.attached",
    "setup_intent.succeeded",
    "setup_intent.created",
})

# Pre-formatted for SQL IN () — safe because this is a hardcoded constant, not user input.
_POSITIVE_STRIPE_SQL = ", ".join(f"'{t}'" for t in sorted(_POSITIVE_STRIPE_TYPES))


def _summarize_event(event: Event, cross_channel: bool = True) -> str:
    """Produce a compact text summary of an event for LLM context.

    cross_channel=True  — include customer/user identifiers so the LLM can
                          group events that affect the same person across sources.
    cross_channel=False — strip all identity fields; group purely by technical
                          pattern (event type, error class, frustration type).
    """
    p = event.payload
    if event.source == "stripe":
        obj = p.get("data", {}).get("object", {})
        status = obj.get("status", "unknown")
        if cross_channel:
            cus = obj.get("customer", p.get("customer", "unknown"))
            amount = obj.get("amount", obj.get("amount_due", 0))
            return f"{event.event_type} | customer:{cus} | amount:{amount} | status:{status}"
        return f"{event.event_type} | status:{status}"

    elif event.source == "sentry":
        data = p.get("data", {})
        evt = data.get("event", {})
        exc_values = evt.get("exception", {}).get("values", [{}])
        exc_type = exc_values[0].get("type", "unknown") if exc_values else "unknown"
        level = data.get("issue", {}).get("level", evt.get("level", "error"))
        if cross_channel:
            user_email = evt.get("user", {}).get("email", "unknown")
            return f"{event.event_type} | error:{exc_type} | user:{user_email} | level:{level}"
        return f"{event.event_type} | error:{exc_type} | level:{level}"

    else:  # fullstory
        data = p.get("data", {})
        frustration = data.get("frustration_type", "none")
        if cross_channel:
            page_url = data.get("page_url", "unknown")
            user_email = data.get("user_email", "unknown")
            return f"{event.event_type} | frustration:{frustration} | page:{page_url} | user:{user_email}"
        # Strip URL to just the path pattern (drop query strings and IDs)
        page_url = data.get("page_url", "")
        try:
            from urllib.parse import urlparse
            path = urlparse(page_url).path
        except Exception:
            path = "unknown"
        return f"{event.event_type} | frustration:{frustration} | path:{path}"


async def _assign_or_create(
    event_summary: str,
    open_clusters: list[Cluster],
    client,
    model: str,
    is_local: bool,
    cross_channel: bool = True,
) -> dict:
    """Ask the LLM to assign this event to an existing cluster or create a new one."""
    cluster_summaries = [
        f"- id:{str(c.id)} title:{c.title!r} root_cause:{c.root_cause!r}"
        for c in open_clusters
    ]
    clusters_text = "\n".join(cluster_summaries) if cluster_summaries else "(none)"

    if cross_channel:
        system_prompt = (
            "You assign events to issue clusters based on shared root cause. "
            "Events from different sources (Stripe, Sentry, FullStory) may belong "
            "to the same cluster when they affect the same customers or stem from "
            "the same underlying problem. Respond only with JSON."
        )
    else:
        system_prompt = (
            "You assign events to clusters based on technical pattern only. "
            "Ignore customer or user identifiers entirely. "
            "Group events by their type, error class, or behavior pattern — "
            "a cluster represents a recurring technical issue, not a customer journey. "
            "Respond only with JSON."
        )

    user_msg = f"""Open clusters:
{clusters_text}

New event: {event_summary}

If this event clearly matches an existing cluster by root cause, respond:
{{"action":"assign","cluster_id":"<uuid>"}}

Otherwise respond:
{{"action":"create","title":"<short title under 60 chars>","root_cause":"<one sentence>"}}

Respond only with JSON."""

    kwargs = {} if is_local else {"response_format": {"type": "json_object"}}
    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.1,
        **kwargs,
    )
    return _parse_json(response.choices[0].message.content)


def _ux_signal(event: Event) -> float:
    """Return a 0–1 UX impact score for a single event."""
    if event.source == "fullstory":
        frustration = event.payload.get("data", {}).get("frustration_type", "")
        return {
            "rage_click": 1.0,
            "error_click": 0.85,
            "dead_click": 0.7,
            "thrash": 0.6,
        }.get(frustration, 0.3)
    elif event.source == "sentry":
        data = event.payload.get("data", {})
        level = data.get("issue", {}).get("level", data.get("event", {}).get("level", "error"))
        return {"error": 0.8, "warning": 0.4, "info": 0.1}.get(level, 0.5)
    return 0.3


def _is_negative_signal(event: Event) -> bool:
    """Return True only for events that represent a problem or user friction.

    Positive signals (successful payments, routine activity, info logs) are
    excluded from clustering — the engine focuses on issues that need attention.
    """
    if event.source == "stripe":
        return event.event_type not in _POSITIVE_STRIPE_TYPES
    elif event.source == "sentry":
        data = event.payload.get("data", {})
        level = data.get("issue", {}).get("level", data.get("event", {}).get("level", "error"))
        return level != "info"
    else:  # fullstory
        frustration = (event.payload.get("data", {}).get("frustration_type") or "").lower()
        return frustration not in ("", "none")


def _rescore_cluster(cluster: Cluster, config: ProjectScoringConfig, events: list[Event]) -> None:
    """Recompute revenue/frequency/ux/priority scores on the cluster in-place."""
    # Revenue at risk: only count Stripe events that represent lost/at-risk money.
    # Succeeded payments are not a problem — failed, refunded, disputed, past_due are.
    AT_RISK_TYPES = ("failed", "refund", "past_due", "disputed", "unpaid", "void")
    revenue_cents = 0
    for e in events:
        if e.source == "stripe" and any(t in e.event_type for t in AT_RISK_TYPES):
            obj = e.payload.get("data", {}).get("object", {})
            revenue_cents += obj.get("amount", obj.get("amount_due", 0)) or 0
    revenue_usd = revenue_cents / 100
    cluster.revenue_score = min(revenue_usd / max(config.max_revenue_usd, 1), 1.0)

    # Frequency
    cluster.frequency_score = min(cluster.event_count / max(config.max_frequency_count, 1), 1.0)

    # UX: average of ux signals across all events in cluster
    ux_signals = [_ux_signal(e) for e in events]
    cluster.ux_score = sum(ux_signals) / len(ux_signals) if ux_signals else 0.0

    # Weighted priority score
    cluster.priority_score = (
        cluster.revenue_score * config.weight_revenue
        + cluster.frequency_score * config.weight_frequency
        + cluster.ux_score * config.weight_ux
    )
    cluster.updated_at = datetime.now(timezone.utc)


async def evaluate_project(project_id: uuid.UUID, db: AsyncSession) -> dict:
    """
    Cluster unclustered events for a project and rescore all affected clusters.
    Returns stats: {"clustered": N, "clusters_created": M, "clusters_updated": K}
    """
    # 0. Purge open clusters that consist entirely of positive-signal events.
    #    These are artifacts from before the negative-signal filter was applied.
    #    Marking them resolved removes them from the active view without losing the data.
    await db.execute(
        text(f"""
            UPDATE clusters
               SET status = 'resolved', updated_at = NOW()
             WHERE project_id = :project_id
               AND status = 'open'
               AND id IN (SELECT DISTINCT cluster_id FROM cluster_events)
               AND id NOT IN (
                   SELECT DISTINCT ce.cluster_id
                     FROM cluster_events ce
                     JOIN events e ON e.id = ce.event_id
                    WHERE NOT (
                        (e.source = 'stripe'    AND e.event_type IN ({_POSITIVE_STRIPE_SQL}))
                     OR (e.source = 'sentry'    AND COALESCE(e.payload #>> '{{data,issue,level}}',
                                                              e.payload #>> '{{data,event,level}}',
                                                              'error') = 'info')
                     OR (e.source = 'fullstory' AND COALESCE(e.payload #>> '{{data,frustration_type}}',
                                                              'none') IN ('', 'none'))
                    )
               )
        """),
        {"project_id": str(project_id)},
    )

    # 1. Load or create scoring config
    result = await db.execute(
        select(ProjectScoringConfig).where(ProjectScoringConfig.project_id == project_id)
    )
    config = result.scalar_one_or_none()
    if not config:
        config = ProjectScoringConfig(project_id=project_id)
        db.add(config)
        await db.flush()

    # 2. Fetch unclustered NEGATIVE-signal events via LEFT JOIN.
    #    Positive events are excluded at the SQL level so they never fill the
    #    batch and block negative events from being processed.
    result = await db.execute(
        select(Event)
        .outerjoin(ClusterEvent, ClusterEvent.event_id == Event.id)
        .where(
            Event.project_id == project_id,
            ClusterEvent.event_id.is_(None),
            # Exclude positive Stripe event types (successes, routine activity)
            ~((Event.source == "stripe") & Event.event_type.in_(_POSITIVE_STRIPE_TYPES)),
            # Exclude Sentry info-level events (non-actionable)
            text(
                "NOT (events.source = 'sentry' AND "
                "COALESCE(events.payload #>> '{data,issue,level}', "
                "         events.payload #>> '{data,event,level}', 'error') = 'info')"
            ),
            # Exclude FullStory events with no frustration signal
            text(
                "NOT (events.source = 'fullstory' AND "
                "COALESCE(events.payload #>> '{data,frustration_type}', 'none') "
                "IN ('', 'none'))"
            ),
        )
        .order_by(Event.received_at.asc())
        .limit(50)
    )
    unclustered = result.scalars().all()

    if not unclustered:
        return {"clustered": 0, "clusters_created": 0, "clusters_updated": 0}

    # 3. Load recent open clusters for LLM context
    result = await db.execute(
        select(Cluster)
        .where(
            Cluster.project_id == project_id,
            Cluster.status == "open",
        )
        .options(selectinload(Cluster.cluster_events))
        .order_by(Cluster.last_seen.desc())
        .limit(15)
    )
    open_clusters = result.scalars().all()

    client, model, is_local = _ai_client()
    cross_channel: bool = config.cross_channel

    clusters_created = 0
    clusters_updated_ids: set[uuid.UUID] = set()

    # 4. Process each unclustered event (Python safety-filter in case any
    #    positive signal slips through the SQL filter due to unexpected payload shape)
    for event in unclustered:
        if not _is_negative_signal(event):
            continue

        summary = _summarize_event(event, cross_channel=cross_channel)

        try:
            decision = await _assign_or_create(
                summary, open_clusters, client, model, is_local, cross_channel=cross_channel
            )
        except Exception:
            # On LLM failure, create a new cluster rather than dropping the event
            decision = {
                "action": "create",
                "title": f"{event.source}: {event.event_type}",
                "root_cause": summary[:200],
            }

        target = None

        if decision.get("action") == "assign":
            cluster_id_str = decision.get("cluster_id", "")
            target = next(
                (c for c in open_clusters if str(c.id) == cluster_id_str), None
            )
            if target is None:
                # Cluster ID not found — fall through to create
                decision["action"] = "create"
                decision.setdefault("title", f"{event.source}: {event.event_type}")
                decision.setdefault("root_cause", summary[:200])

        if decision.get("action") == "create" or target is None:
            target = Cluster(
                project_id=project_id,
                title=decision.get("title", f"{event.source}: {event.event_type}")[:200],
                root_cause=decision.get("root_cause", summary)[:500],
                first_seen=event.received_at,
                last_seen=event.received_at,
                event_count=0,
                affected_users=0,
            )
            db.add(target)
            await db.flush()
            open_clusters.append(target)
            clusters_created += 1

        # Upsert ClusterEvent
        db.add(ClusterEvent(cluster_id=target.id, event_id=event.id))

        # Update cluster counters
        target.event_count += 1
        if event.received_at < target.first_seen:
            target.first_seen = event.received_at
        if event.received_at > target.last_seen:
            target.last_seen = event.received_at

        clusters_updated_ids.add(target.id)

    await db.flush()

    # 5. Rescore affected clusters
    for cluster in open_clusters:
        if cluster.id not in clusters_updated_ids:
            continue
        # Load all events for this cluster to rescore
        result = await db.execute(
            select(Event)
            .join(ClusterEvent, ClusterEvent.event_id == Event.id)
            .where(ClusterEvent.cluster_id == cluster.id)
        )
        cluster_events = result.scalars().all()

        # Update affected_users
        user_ids: set[str] = set()
        for e in cluster_events:
            p = e.payload
            if e.source == "stripe":
                uid = p.get("data", {}).get("object", {}).get("customer", "")
            elif e.source == "sentry":
                uid = p.get("data", {}).get("event", {}).get("user", {}).get("email", "")
            else:
                uid = p.get("data", {}).get("user_email", "")
            if uid:
                user_ids.add(uid)
        cluster.affected_users = len(user_ids)

        _rescore_cluster(cluster, config, cluster_events)

    await db.commit()

    return {
        "clustered": len(unclustered),
        "clusters_created": clusters_created,
        "clusters_updated": len(clusters_updated_ids) - clusters_created,
    }


async def evaluate_all_projects(db: AsyncSession) -> None:
    """Find all projects with unclustered events and evaluate each."""
    # Find project_ids that have events not yet in cluster_events
    result = await db.execute(
        select(Event.project_id)
        .outerjoin(ClusterEvent, ClusterEvent.event_id == Event.id)
        .where(ClusterEvent.event_id.is_(None))
        .distinct()
    )
    project_ids = [row[0] for row in result.all()]

    for project_id in project_ids:
        try:
            await evaluate_project(project_id, db)
        except Exception:
            # Don't let one project failure block others
            await db.rollback()
