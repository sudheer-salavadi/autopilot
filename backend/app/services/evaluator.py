"""
Correlation & Prioritization Engine.

Groups raw events into clusters (same root cause) and scores each cluster
using a weighted formula: Score = Revenue*w1 + Frequency*w2 + UX*w3
"""
import uuid
from datetime import datetime, timezone

from openai import AsyncOpenAI
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.db.session import AsyncSessionLocal
from app.models.cluster import Cluster, ClusterEvent
from app.models.event import Event
from app.models.scoring_config import ProjectScoringConfig
from app.services.demo import ai_chat, _parse_json
import app.services.sources as sources  # registers all plugins on import

_EMBEDDING_MODEL = "text-embedding-3-small"
_EMBEDDING_DIMS = 1536
_REGRESSION_SIMILARITY_THRESHOLD = 0.92  # cosine similarity — tune as needed


def _embedding_client() -> AsyncOpenAI | None:
    """Always use OpenAI for embeddings (LM Studio may not support them).
    Returns None if no API key is configured — embeddings are skipped gracefully.
    """
    if settings.OPENAI_API_KEY:
        return AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    return None


async def _generate_embedding(text_input: str) -> list[float] | None:
    """Generate a 1536-dim embedding for the given text. Returns None on any failure."""
    client = _embedding_client()
    if not client:
        return None
    try:
        resp = await client.embeddings.create(
            model=_EMBEDDING_MODEL, input=text_input
        )
        return resp.data[0].embedding
    except Exception:
        return None


def _cosine_sim(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two equal-length float vectors (no numpy needed)."""
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = sum(x * x for x in a) ** 0.5
    mag_b = sum(x * x for x in b) ** 0.5
    if mag_a == 0.0 or mag_b == 0.0:
        return 0.0
    return dot / (mag_a * mag_b)


def _candidate_clusters(
    event_embedding: list[float] | None,
    open_clusters: list[Cluster],
    top_k: int = 5,
) -> list[Cluster]:
    """Return the top-K open clusters most semantically similar to the event.

    Pre-filters the candidate list the LLM receives, reducing token usage and
    keeping context focused on plausible matches. Falls back to the first top_k
    clusters (by recency) when embeddings are unavailable.
    """
    if event_embedding is None or not open_clusters:
        return open_clusters[:top_k]

    scored: list[tuple[float, Cluster]] = []
    unembedded: list[Cluster] = []

    for c in open_clusters:
        if c.embedding is not None:
            sim = _cosine_sim(event_embedding, list(c.embedding))
            scored.append((sim, c))
        else:
            unembedded.append(c)

    if not scored:
        # No clusters have embeddings yet — fall back to recency order
        return open_clusters[:top_k]

    scored.sort(key=lambda x: x[0], reverse=True)
    candidates = [c for _, c in scored[:top_k]]
    return candidates


async def _detect_regression(
    new_cluster: Cluster, db: AsyncSession
) -> Cluster | None:
    """Check whether a newly created cluster is a regression of a resolved one.

    Uses pgvector cosine similarity on embeddings. Returns the best-matching
    resolved cluster if similarity exceeds the threshold, else None.
    """
    if new_cluster.embedding is None:
        return None

    result = await db.execute(
        text(
            """
            SELECT id, title, regression_count,
                   1 - (embedding <=> CAST(:vec AS vector)) AS similarity
              FROM clusters
             WHERE project_id = :project_id
               AND status     = 'resolved'
               AND embedding  IS NOT NULL
               AND id         != :new_id
             ORDER BY embedding <=> CAST(:vec AS vector)
             LIMIT 1
            """
        ),
        {
            "vec": str(new_cluster.embedding),
            "project_id": str(new_cluster.project_id),
            "new_id": str(new_cluster.id),
        },
    )
    row = result.fetchone()
    if row and row.similarity >= _REGRESSION_SIMILARITY_THRESHOLD:
        parent = await db.get(Cluster, row.id)
        return parent
    return None

# Stripe positive-event constants — sourced from the Stripe plugin so there is
# a single source of truth used by both the Python filter and the SQL filter.
from app.services.sources.stripe import POSITIVE_SQL as _POSITIVE_STRIPE_SQL
from app.services.sources.stripe import POSITIVE_TYPES as _POSITIVE_STRIPE_TYPES


def _summarize_event(event: Event, cross_channel: bool = True) -> str:
    """Produce a compact text summary of an event for LLM context.

    Dispatches to the registered SourcePlugin for the event's source.
    Falls back to a generic summary for unrecognised sources so that new
    sources work correctly the moment their plugin is registered, and even
    before a plugin exists they won't be silently dropped.
    """
    plugin = sources.get(event.source)
    if plugin:
        return plugin.summarize(event, cross_channel)
    # Generic fallback for unknown sources
    return f"{event.source}:{event.event_type}"


async def _assign_or_create(
    event_summary: str,
    open_clusters: list[Cluster],
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

    text = await ai_chat(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.1,
    )
    return _parse_json(text)


def _ux_signal(event: Event) -> float:
    """Return a 0–1 UX impact score for a single event via the source plugin."""
    plugin = sources.get(event.source)
    return plugin.ux_signal(event) if plugin else 0.3


def _is_negative_signal(event: Event) -> bool:
    """Return True only for events that represent a problem or user friction.

    Dispatches to the registered SourcePlugin.  Unknown sources default to
    True (cluster everything) so new sources surface in the UI immediately.
    """
    plugin = sources.get(event.source)
    return plugin.is_negative(event) if plugin else True


def _rich_event_line(e: Event) -> str:
    """Build a detailed, source-specific event description for LLM insight generation."""
    plugin = sources.get(e.source)
    if plugin:
        return plugin.rich_line(e)
    # Generic fallback for unknown sources
    return f"  - {e.source}:{e.event_type}"


async def _regenerate_insight(
    cluster: Cluster,
    events: list[Event],
    cross_channel: bool = True,
) -> None:
    """Re-generate title and root_cause from the cluster's actual negative events.

    Groups events by source and builds a rich, element/page-aware context so the
    LLM can identify causal chains (e.g. backend errors → UI frustration) and
    produce specific, actionable descriptions rather than generic summaries.
    """
    negative = [e for e in events if _is_negative_signal(e)]
    if not negative:
        return

    # Group rich event lines by source
    stripe_lines: list[str] = []
    sentry_lines: list[str] = []
    fullstory_lines: list[str] = []
    for e in negative[:15]:
        line = _rich_event_line(e)
        if e.source == "stripe":
            stripe_lines.append(line)
        elif e.source == "sentry":
            sentry_lines.append(line)
        else:
            fullstory_lines.append(line)

    context_parts: list[str] = []
    if stripe_lines:
        context_parts.append("STRIPE events:\n" + "\n".join(stripe_lines))
    if sentry_lines:
        context_parts.append("SENTRY events:\n" + "\n".join(sentry_lines))
    if fullstory_lines:
        context_parts.append("FULLSTORY events:\n" + "\n".join(fullstory_lines))

    events_text = "\n\n".join(context_parts)
    sources_active = sum(1 for s in [stripe_lines, sentry_lines, fullstory_lines] if s)

    cross_source_hint = ""
    if sources_active > 1:
        cross_source_hint = (
            "\n\nNOTE: This cluster spans multiple data sources. "
            "If Sentry backend errors correlate with FullStory user frustration, "
            "describe the causal chain: what is broken at the backend level and how "
            "that manifests as a degraded experience (e.g. dead clicks, rage clicks) "
            "on a specific page or element. Name the page, the failing operation, "
            "and the error type where the data supports it."
        )

    user_msg = f"""These events all belong to the same issue cluster:

{events_text}

Current title: {cluster.title!r}
Current root cause: {cluster.root_cause!r}

Generate an accurate title and one-sentence root cause based solely on the events above.
- Be specific: reference the exact page, element name, error class, or operation if present.
- Identify the root cause (backend error, payment failure, broken UI interaction).
- Do NOT use vague language like "an issue occurred" or "some problem".
- Do NOT describe successful or routine activity.{cross_source_hint}

Respond only with JSON:
{{"title":"<concise title, under 60 chars>","root_cause":"<one sentence — specific, names what broke and where>"}}"""

    try:
        text = await ai_chat(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a software reliability engineer summarizing production incidents. "
                        "Be specific and concise. Respond only with JSON."
                    ),
                },
                {"role": "user", "content": user_msg},
            ],
            temperature=0.1,
        )
        result = _parse_json(text)
        if result.get("title"):
            cluster.title = result["title"][:200]
        if result.get("root_cause"):
            cluster.root_cause = result["root_cause"][:500]
    except Exception:
        pass  # Keep existing title/root_cause on LLM failure

    # Generate embedding from the (possibly updated) title + root_cause.
    # This runs regardless of whether the LLM call above succeeded, so clusters
    # that kept their existing title still get an embedding on first pass.
    embedding = await _generate_embedding(f"{cluster.title}. {cluster.root_cause}")
    if embedding is not None:
        cluster.embedding = embedding


async def _generate_pm_insight(
    cluster: Cluster,
    events: list[Event],
    config: ProjectScoringConfig,
) -> None:
    """Generate a PM-quality insight: cross-source synthesis, owner, and recommended action.

    Stored on cluster.pm_insight. Runs after _regenerate_insight so title/root_cause
    are already accurate. Non-blocking — silently skips on any LLM failure.
    """
    from collections import Counter
    from app.services.sources.stripe import POSITIVE_TYPES as _POSITIVE_STRIPE_TYPES

    negative = [e for e in events if _is_negative_signal(e)]
    if not negative:
        return

    # Build source breakdown with human-readable signal counts
    source_counts = Counter(e.source for e in negative)
    source_lines: list[str] = []

    # Stripe: compute actual revenue at risk
    stripe_events = [e for e in negative if e.source == "stripe"]
    if stripe_events:
        AT_RISK_TYPES = ("failed", "refund", "past_due", "disputed", "unpaid", "void")
        revenue_cents = sum(
            (e.payload.get("data", {}).get("object", {}).get("amount")
             or e.payload.get("data", {}).get("object", {}).get("amount_due") or 0)
            for e in stripe_events
            if any(t in e.event_type for t in AT_RISK_TYPES)
        )
        revenue_str = f"${revenue_cents / 100:,.0f} at risk" if revenue_cents else f"{len(stripe_events)} events"
        source_lines.append(f"- Stripe: {len(stripe_events)} payment events ({revenue_str})")

    if source_counts.get("sentry"):
        # Pull top error type for context
        exc_types = []
        for e in negative:
            if e.source != "sentry":
                continue
            exc_vals = (e.payload.get("data", {}).get("event", {})
                        .get("exception", {}).get("values", []))
            if exc_vals:
                exc_types.append(exc_vals[-1].get("type", ""))
        top_error = Counter(t for t in exc_types if t).most_common(1)
        error_str = f" — {top_error[0][0]}" if top_error else ""
        source_lines.append(f"- Sentry: {source_counts['sentry']} errors{error_str}")

    if source_counts.get("fullstory"):
        frustrations = []
        for e in negative:
            if e.source != "fullstory":
                continue
            fr = e.payload.get("data", {}).get("frustration_type") or e.event_type
            if fr and fr not in ("none", "session_start", "session_end"):
                frustrations.append(fr)
        top_fr = Counter(frustrations).most_common(1)
        fr_str = f" — {top_fr[0][0].replace('_', ' ')}" if top_fr else ""
        source_lines.append(f"- FullStory: {source_counts['fullstory']} sessions{fr_str}")

    if source_counts.get("zendesk"):
        priorities = []
        for e in negative:
            if e.source != "zendesk":
                continue
            p = (e.payload.get("detail", {}) or {}).get("priority", "")
            if p:
                priorities.append(p.lower())
        top_p = Counter(priorities).most_common(1)
        p_str = f" — {top_p[0][0]} priority" if top_p else ""
        source_lines.append(f"- Zendesk: {source_counts['zendesk']} tickets{p_str}")

    # Cross-source identity overlap
    identity_sources: dict[str, set[str]] = {}
    for e in negative:
        p = e.payload
        uid = ""
        if e.source == "stripe":
            uid = str(p.get("data", {}).get("object", {}).get("customer") or
                      p.get("data", {}).get("object", {}).get("metadata", {}).get("email") or "")
        elif e.source == "sentry":
            uid = str(p.get("data", {}).get("event", {}).get("user", {}).get("email") or "")
        elif e.source == "fullstory":
            uid = str(p.get("data", {}).get("user_email") or p.get("data", {}).get("user_id") or "")
        elif e.source == "zendesk":
            uid = str((p.get("detail", {}) or {}).get("external_id") or
                      (p.get("detail", {}) or {}).get("requester_id") or "")
        if uid and uid not in ("unknown", "null", "undefined"):
            if uid not in identity_sources:
                identity_sources[uid] = set()
            identity_sources[uid].add(e.source)
    cross_source_users = [uid for uid, srcs in identity_sources.items() if len(srcs) > 1]
    cross_hint = (
        f"\n{len(cross_source_users)} user(s) appear in signals from multiple tools "
        f"(confirmed blast radius)."
        if cross_source_users else ""
    )

    sources_active = [s for s in ["stripe", "sentry", "fullstory", "zendesk"] if source_counts.get(s)]
    user_str = f"{cluster.affected_users} user{'s' if cluster.affected_users != 1 else ''}"
    signal_block = "\n".join(source_lines)

    prompt = f"""You are a senior product manager writing a concise incident insight.

Cluster: "{cluster.title}"
Root cause: "{cluster.root_cause}"

Signal breakdown ({user_str} affected):
{signal_block}{cross_hint}

Write a PM insight in exactly 2-3 sentences that:
1. Connects what happened across the signals (the user journey from error → frustration → complaint)
2. States the owner clearly: "Engineering:" for code/infra bugs, "CS:" for customer-side payment issues, "Product:" for UX/flow problems
3. Gives one specific, actionable next step

Be direct. No filler. Name the specific component, page, or error type if the data supports it.

Respond only with JSON: {{"insight": "<2-3 sentences>"}}"""

    try:
        text = await ai_chat(
            messages=[
                {"role": "system", "content": "You are a senior PM writing concise incident insights. Respond only with JSON."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
        )
        result = _parse_json(text)
        insight = result.get("insight", "")
        if insight:
            cluster.pm_insight = insight[:1000]
    except Exception:
        pass  # Non-blocking — cluster works fine without pm_insight


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
                        (e.source = 'stripe'    AND (
                                                       e.event_type IN ({_POSITIVE_STRIPE_SQL})
                                                       OR e.payload #>> '{{data,object,status}}' IN ('paid','succeeded','active','trialing','complete')
                                                     ))
                     OR (e.source = 'sentry'    AND (
                                                       COALESCE(e.payload #>> '{{data,issue,level}}',
                                                                e.payload #>> '{{data,event,level}}',
                                                                'error') IN ('info', 'unknown')
                                                       OR e.event_type IN ('issue.resolved', 'issue.ignored')
                                                       OR COALESCE(e.payload #>> '{{action}}', '') IN ('resolved', 'ignored')
                                                     ))
                     OR (e.source = 'fullstory' AND (
                                                       COALESCE(e.payload #>> '{{data,frustration_type}}', 'none') IN ('', 'none')
                                                       OR e.event_type IN ('session_start', 'session_end', 'session_url_changed')
                                                     ))
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
            # Also exclude Stripe events where payload status is positive (catches event_type/status mismatches)
            text(
                "NOT (events.source = 'stripe' AND "
                "events.payload #>> '{data,object,status}' IN "
                "('paid','succeeded','active','trialing','complete'))"
            ),
            # Exclude Sentry non-actionable events (info/unknown level, resolved/ignored issues)
            text(
                "NOT (events.source = 'sentry' AND ("
                "  COALESCE(events.payload #>> '{data,issue,level}', "
                "           events.payload #>> '{data,event,level}', 'error') IN ('info', 'unknown')"
                "  OR events.event_type IN ('issue.resolved', 'issue.ignored')"
                "  OR COALESCE(events.payload #>> '{action}', '') IN ('resolved', 'ignored')"
                "))"
            ),
            # Exclude FullStory events with no frustration signal or session lifecycle events
            text(
                "NOT (events.source = 'fullstory' AND ("
                "  COALESCE(events.payload #>> '{data,frustration_type}', 'none') IN ('', 'none')"
                "  OR events.event_type IN ('session_start', 'session_end', 'session_url_changed')"
                "))"
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

    cross_channel: bool = config.cross_channel

    clusters_created = 0
    clusters_updated_ids: set[uuid.UUID] = set()

    # 4. Process each unclustered event (Python safety-filter in case any
    #    positive signal slips through the SQL filter due to unexpected payload shape)
    for event in unclustered:
        if not _is_negative_signal(event):
            continue

        summary = _summarize_event(event, cross_channel=cross_channel)

        # Pre-filter candidate clusters using vector similarity so the LLM
        # only sees the most relevant context (reduces tokens, improves accuracy).
        event_embedding = await _generate_embedding(summary)
        candidates = _candidate_clusters(event_embedding, open_clusters)

        try:
            decision = await _assign_or_create(
                summary, candidates, cross_channel=cross_channel
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

            # Check if this is a regression of a resolved cluster.
            # We need an embedding first — generate a provisional one from the
            # LLM-assigned title/root_cause so we can run similarity immediately.
            provisional_embedding = await _generate_embedding(
                f"{target.title}. {target.root_cause}"
            )
            if provisional_embedding is not None:
                target.embedding = provisional_embedding
                parent = await _detect_regression(target, db)
                if parent is not None:
                    target.parent_cluster_id = parent.id
                    parent.regression_count += 1

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

        # Regenerate title/root_cause from the actual negative events so the
        # description always matches the scores (e.g. a cluster seeded with a
        # positive event but later filled with failures gets corrected here).
        if cluster.event_count >= 2:
            await _regenerate_insight(cluster, cluster_events, cross_channel)
            # Generate PM-quality synthesis: cross-source narrative + owner + action.
            # Runs after _regenerate_insight so it has the final title/root_cause.
            await _generate_pm_insight(cluster, cluster_events, config)

    await db.commit()

    # 6. Autopilot — auto-file GitHub issues for clusters that crossed the threshold.
    #    Runs after commit so scores are final. Failures are non-blocking.
    await _autopilot_github(project_id, clusters_updated_ids, db)

    return {
        "clustered": len(unclustered),
        "clusters_created": clusters_created,
        "clusters_updated": len(clusters_updated_ids) - clusters_created,
    }


# ---------------------------------------------------------------------------
# Stripe error code classification
# ---------------------------------------------------------------------------
#
# Not every Stripe failure is engineering's problem. Before filing a GitHub
# issue we classify the cluster's Stripe events to determine who should act.
#
# CUSTOMER_ERRORS — the card or bank rejected the charge for a customer-side
#   reason.  Engineering cannot fix these.  The right owner is Customer Success
#   (CS), whose playbook is:
#     - insufficient_funds / account_closed: send a dunning email immediately;
#       retry after 3/5/7 days via Stripe's Smart Retries or a manual retry
#       schedule; escalate to account manager if MRR > threshold.
#     - card_expired: trigger an automated "update your card" email sequence
#       (Stripe has a built-in one); pause subscription after N days.
#     - card_declined / do_not_honor / restricted_card: ask the customer to
#       contact their bank or try a different card.
#     - lost_card / stolen_card: cancel the card on file immediately; contact
#       customer to re-add a valid card; flag for fraud review if pattern repeats.
#     - fraudulent / pickup_card: freeze the account, flag for the Finance /
#       Risk team, do NOT retry — retrying a card flagged fraudulent worsens
#       Stripe's fraud score for your account.
#
# TODO: Route CUSTOMER_ERRORS to a CS alert channel (e.g. Slack webhook,
#   Intercom conversation, or an internal "billing alerts" view in Autopilot)
#   rather than filing a GitHub issue.  The cluster should still be visible
#   in the Issues feed with an "Owner: CS" badge so nothing is silently dropped.
#
# INFRASTRUCTURE_ERRORS — failures caused by a bug or misconfiguration in
#   your own code or Stripe integration.  These belong in GitHub.
#
# Codes not in either list (e.g. new Stripe codes) default to filing a GitHub
# issue so nothing slips through silently.
# ---------------------------------------------------------------------------

_CUSTOMER_ERRORS: frozenset[str] = frozenset({
    # Funds / account
    "insufficient_funds",
    "account_closed",
    "debit_not_authorized",
    # Card lifecycle
    "card_expired",
    "expired_card",
    # Generic declines — customer or bank side
    "card_declined",
    "do_not_honor",
    "restricted_card",
    "card_not_supported",
    "currency_not_supported",
    "card_velocity_exceeded",
    # Lost / stolen — CS + Finance action
    "lost_card",
    "stolen_card",
    # Fraud — Finance / Risk action, never retry
    "fraudulent",
    "pickup_card",
    "pickup_card_other",
})

_INFRASTRUCTURE_ERRORS: frozenset[str] = frozenset({
    # Your code sent a bad request to Stripe
    "invalid_request_error",
    "parameter_invalid_empty",
    "parameter_invalid_integer",
    "parameter_missing",
    "resource_missing",
    # Stripe couldn't reach your server (webhook delivery failures)
    "api_connection_error",
    "api_error",
    # Rate limiting — your integration needs backoff / queue
    "rate_limit",
    "lock_timeout",
    # Idempotency misuse
    "idempotency_key_in_use",
})


def _stripe_owner(failure_code: str | None) -> str:
    """Return 'cs', 'engineering', or 'unknown' for a Stripe decline code."""
    if not failure_code:
        return "unknown"
    code = failure_code.lower()
    if code in _CUSTOMER_ERRORS:
        return "cs"
    if code in _INFRASTRUCTURE_ERRORS:
        return "engineering"
    return "unknown"  # file GitHub issue by default — don't silently drop


def _cluster_is_engineering_actionable(events: list[Event]) -> bool:
    """Return True if at least one event in the cluster is engineering-owned.

    A cluster mixing infrastructure errors and customer errors (e.g. a bad
    API call that then surfaces as a card_declined) is still engineering-owned.
    A cluster made up entirely of customer-side Stripe errors should not
    create GitHub noise.
    """
    stripe_events = [e for e in events if e.source == "stripe"]
    non_stripe_events = [e for e in events if e.source != "stripe"]

    # Non-Stripe sources (Sentry errors, FullStory rage-clicks) are always
    # engineering signals — a broken button or a server exception is fixable.
    if non_stripe_events:
        return True

    # No events at all — default to filing
    if not stripe_events:
        return True

    # Check each Stripe event's decline code
    for event in stripe_events:
        payload = event.payload or {}
        # Stripe wraps the error under data.object.failure_code or
        # last_payment_error.code depending on the event type
        failure_code = (
            payload.get("data", {}).get("object", {}).get("failure_code")
            or payload.get("data", {}).get("object", {})
                .get("last_payment_error", {}).get("code")
        )
        if _stripe_owner(failure_code) != "cs":
            # At least one event is engineering or unknown — file the issue
            return True

    # Every Stripe event in this cluster is a customer-side error
    return False


async def _autopilot_github(
    project_id: uuid.UUID,
    updated_cluster_ids: set[uuid.UUID],
    db: AsyncSession,
) -> None:
    """Auto-create GitHub issues for clusters that exceed the autopilot threshold."""
    from collections import Counter

    from app.models.github_config import ProjectGithubConfig
    from app.services import github as gh

    # Load GitHub config — if not configured or autopilot off, nothing to do
    gh_result = await db.execute(
        select(ProjectGithubConfig).where(
            ProjectGithubConfig.project_id == project_id
        )
    )
    gh_config = gh_result.scalar_one_or_none()
    if (
        not gh_config
        or not gh_config.autopilot_enabled
        or not gh_config.installation_id
        or not gh_config.repo
    ):
        return

    # Load the project slug for the issue body link
    from app.models.project import Project
    proj_result = await db.execute(
        select(Project.slug).where(Project.id == project_id)
    )
    project_slug = proj_result.scalar_one_or_none() or ""

    # Check each updated cluster against the threshold
    for cluster_id in updated_cluster_ids:
        result = await db.execute(select(Cluster).where(Cluster.id == cluster_id))
        cluster = result.scalar_one_or_none()
        if not cluster:
            continue

        # Skip if: already has an issue, below threshold, too few events, or resolved
        if (
            cluster.github_issue_number
            or cluster.priority_score < gh_config.autopilot_min_score
            or cluster.event_count < 3
            or cluster.status.value == "resolved"
        ):
            continue

        # Load full events — needed for both actionability check and source counts
        events_result = await db.execute(
            select(Event)
            .join(ClusterEvent, ClusterEvent.event_id == Event.id)
            .where(ClusterEvent.cluster_id == cluster_id)
        )
        cluster_events = events_result.scalars().all()
        source_counts = dict(Counter(e.source for e in cluster_events))

        # Skip GitHub filing if every event in the cluster is a customer-side
        # Stripe error (insufficient_funds, card_expired, etc.).  Engineering
        # cannot fix these — they belong in a CS alert, not a GitHub issue.
        # TODO: replace this early-continue with a CS routing call once the
        # alert channel is implemented (Slack / Intercom / internal feed).
        if not _cluster_is_engineering_actionable(list(cluster_events)):
            continue

        # Regression context
        is_regression = cluster.parent_cluster_id is not None
        parent_title = parent_issue_number = parent_issue_url = None
        if is_regression:
            parent_result = await db.execute(
                select(Cluster).where(Cluster.id == cluster.parent_cluster_id)
            )
            parent = parent_result.scalar_one_or_none()
            if parent:
                parent_title = parent.title
                parent_issue_number = parent.github_issue_number
                parent_issue_url = parent.github_issue_url

                # If parent has a GitHub issue, reopen it instead of creating a new one
                if parent.github_issue_number and parent.github_issue_url:
                    try:
                        comment = (
                            f"⚠️ **Regression detected by Autopilot** — "
                            f"{cluster.event_count} new events after this issue was closed.\n\n"
                            f"[View cluster →]({settings.FRONTEND_URL}/projects/{project_slug}/clusters/{cluster.id})"
                        )
                        await gh.reopen_issue(
                            repo=gh_config.repo,
                            issue_number=parent.github_issue_number,
                            comment=comment,
                            installation_id=gh_config.installation_id,
                        )
                        # Link the regression cluster to the reopened issue
                        cluster.github_issue_number = parent.github_issue_number
                        cluster.github_issue_url = parent.github_issue_url
                        await db.commit()
                    except Exception:
                        pass
                    continue

        body = gh.build_issue_body(
            cluster=cluster,
            project_slug=project_slug,
            frontend_url=settings.FRONTEND_URL,
            source_counts=source_counts,
            is_regression=is_regression,
            parent_title=parent_title,
            parent_issue_number=parent_issue_number,
            parent_issue_url=parent_issue_url,
        )

        try:
            issue = await gh.create_issue(
                repo=gh_config.repo,
                title=f"[Autopilot] {cluster.title}",
                body=body,
                labels=["autopilot"],
                installation_id=gh_config.installation_id,
            )
            cluster.github_issue_number = issue["number"]
            cluster.github_issue_url = issue["html_url"]
            from app.models.cluster import ClusterStatus
            if cluster.status == ClusterStatus.open:
                cluster.status = ClusterStatus.investigating
            await db.commit()
        except Exception:
            pass  # Non-blocking — next evaluate cycle will retry


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
