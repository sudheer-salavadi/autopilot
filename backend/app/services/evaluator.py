"""
Correlation & Prioritization Engine.

Groups raw events into clusters (same root cause) and scores each cluster
using a weighted formula: Score = Revenue*w1 + Frequency*w2 + UX*w3

Clustering uses a three-tier approach to minimise LLM API calls:
  1. Batch-embed all unclustered events in one call to the configured
     embedding model (OpenAI, or any BYO OpenAI-compatible endpoint — see
     app.services.llm) at the start of evaluate_project, regardless of
     event count.
  2. pgvector `<=>` similarity against open cluster embeddings decides
     assign vs create for the high-confidence and low-confidence cases.
  3. LLM is called only for the ambiguous middle range (0.60–0.88 similarity)
     where cross-source correlation judgment is genuinely needed, and for
     cluster naming when a new cluster is created.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.db.session import AsyncSessionLocal
from app.models.cluster import Cluster, ClusterEvent
from app.models.event import Event
from app.models.scoring_config import ProjectScoringConfig
from app.services.llm import ai_chat, _parse_json, embedding_client
from app.services.webhook_dispatch import (
    EVENT_CLUSTER_CREATED,
    EVENT_CLUSTER_ISSUE_FILED,
    EVENT_CLUSTER_SCORED,
    cluster_payload,
    emit_event,
)
import app.services.sources as sources  # registers all plugins on import

logger = logging.getLogger(__name__)

_REGRESSION_SIMILARITY_THRESHOLD = 0.92

# Thresholds for the three-tier clustering decision:
#   >= AUTO_ASSIGN  → pgvector match is confident enough, skip LLM
#   <  AUTO_CREATE  → clearly unrelated to any open cluster, skip LLM
#   between the two → LLM decides (cross-source ambiguity, ~15% of events)
_AUTO_ASSIGN_THRESHOLD = 0.88
_AUTO_CREATE_THRESHOLD = 0.60


async def _generate_embedding(text_input: str) -> list[float] | None:
    """Generate a single embedding. Used for cluster title/root_cause only."""
    resolved = embedding_client()
    if not resolved:
        return None
    client, model = resolved
    try:
        resp = await client.embeddings.create(model=model, input=text_input)
        return resp.data[0].embedding
    except Exception:
        return None


async def _batch_embed_events(
    events: list[Event], summaries: dict[uuid.UUID, str], db: AsyncSession
) -> None:
    """Embed all events that don't have an embedding yet in a single API call.

    The embeddings endpoint (OpenAI, or any OpenAI-compatible BYO endpoint)
    accepts a batch of inputs per request. We store the result on
    event.embedding so subsequent evaluate_project calls skip these events
    entirely — no redundant embedding work.
    """
    resolved = embedding_client()
    if not resolved:
        return
    client, model = resolved

    to_embed = [e for e in events if e.embedding is None]
    if not to_embed:
        return

    texts = [summaries[e.id] for e in to_embed]
    try:
        resp = await client.embeddings.create(model=model, input=texts)
        for event, emb_obj in zip(to_embed, resp.data):
            event.embedding = emb_obj.embedding
            db.add(event)
    except Exception:
        pass  # Graceful degradation — events without embeddings fall through to LLM path


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


async def _find_best_cluster(
    event: Event,
    project_id: uuid.UUID,
    db: AsyncSession,
) -> tuple[Cluster | None, float]:
    """Return the open cluster most similar to this event's embedding and its similarity.

    Uses pgvector's <=> (cosine distance) operator directly in SQL — index-backed,
    no Python loop over in-memory clusters needed. Returns (None, 0.0) when the
    event has no embedding or no open clusters exist.
    """
    if event.embedding is None:
        return None, 0.0

    result = await db.execute(
        text(
            """
            SELECT id,
                   1 - (embedding <=> CAST(:vec AS vector)) AS similarity
              FROM clusters
             WHERE project_id = :project_id
               AND status IN ('open', 'investigating')
               AND embedding IS NOT NULL
             ORDER BY embedding <=> CAST(:vec AS vector)
             LIMIT 1
            """
        ),
        {"vec": str(event.embedding), "project_id": str(project_id)},
    )
    row = result.fetchone()
    if not row:
        return None, 0.0

    cluster = await db.get(Cluster, row.id)
    return cluster, float(row.similarity)


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


async def _llm_assign_or_create(
    event_summary: str,
    candidate: Cluster | None,
    cross_channel: bool = True,
) -> dict:
    """LLM tiebreaker for the ambiguous similarity range (0.60–0.88).

    Only called when pgvector finds a plausible but not confident match.
    Passes a single candidate cluster so the LLM has focused context rather
    than a noisy list of all open clusters.
    """
    if candidate:
        clusters_text = (
            f"- id:{str(candidate.id)} title:{candidate.title!r} "
            f"root_cause:{candidate.root_cause!r}"
        )
    else:
        clusters_text = "(none)"

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

    user_msg = f"""Candidate cluster:
{clusters_text}

New event: {event_summary}

If this event clearly matches the candidate cluster by root cause, respond:
{{"action":"assign","cluster_id":"<uuid>"}}

Otherwise respond:
{{"action":"create","title":"<short title under 60 chars>","root_cause":"<one sentence>"}}

Respond only with JSON."""

    result_text = await ai_chat(
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.1,
    )
    return _parse_json(result_text)


async def _llm_name_cluster(event_summary: str) -> dict:
    """Ask the LLM to name a new cluster based solely on the triggering event.

    Called only when pgvector is confident this event doesn't match any cluster
    (similarity < _AUTO_CREATE_THRESHOLD), so we only need a title + root_cause.
    """
    result_text = await ai_chat(
        messages=[
            {
                "role": "system",
                "content": (
                    "You name new issue clusters. Given an event description, "
                    "produce a short title and one-sentence root cause. Respond only with JSON."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Event: {event_summary}\n\n"
                    "Respond only with JSON:\n"
                    '{"title":"<under 60 chars>","root_cause":"<one sentence>"}'
                ),
            },
        ],
        temperature=0.1,
    )
    return _parse_json(result_text)


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


async def _rescore_cluster(cluster: Cluster, config: ProjectScoringConfig, events: list[Event]) -> None:
    """Recompute revenue/frequency/ux/priority scores on the cluster in-place.

    If config.scoring_webhook_url is set, this is a pluggable stage: the raw
    signal data is POSTed to that URL (HMAC-signed) and the returned scores
    are used instead of the formula below. Any failure (timeout, bad response,
    unreachable) falls back to the internal formula — a broken scoring plugin
    degrades to default behavior, it never breaks clustering.
    """
    # Revenue at risk: only count Stripe events that represent lost/at-risk money.
    # Succeeded payments are not a problem — failed, refunded, disputed, past_due are.
    AT_RISK_TYPES = ("failed", "refund", "past_due", "disputed", "unpaid", "void")
    revenue_cents = 0
    for e in events:
        if e.source == "stripe" and any(t in e.event_type for t in AT_RISK_TYPES):
            obj = e.payload.get("data", {}).get("object", {})
            revenue_cents += obj.get("amount", obj.get("amount_due", 0)) or 0
    revenue_usd = revenue_cents / 100
    ux_signals = [_ux_signal(e) for e in events]

    revenue_score = min(revenue_usd / max(config.max_revenue_usd, 1), 1.0)
    frequency_score = min(cluster.event_count / max(config.max_frequency_count, 1), 1.0)
    ux_score = sum(ux_signals) / len(ux_signals) if ux_signals else 0.0
    priority_override: float | None = None

    if config.scoring_webhook_url:
        override = await _call_scoring_webhook(
            config,
            cluster=cluster,
            revenue_usd=revenue_usd,
            ux_signals=ux_signals,
        )
        if override:
            revenue_score = override.get("revenue_score", revenue_score)
            frequency_score = override.get("frequency_score", frequency_score)
            ux_score = override.get("ux_score", ux_score)
            priority_override = override.get("priority_score")

    cluster.revenue_score = revenue_score
    cluster.frequency_score = frequency_score
    cluster.ux_score = ux_score
    cluster.priority_score = (
        priority_override
        if priority_override is not None
        else (
            revenue_score * config.weight_revenue
            + frequency_score * config.weight_frequency
            + ux_score * config.weight_ux
        )
    )
    cluster.updated_at = datetime.now(timezone.utc)


async def _call_scoring_webhook(
    config: ProjectScoringConfig,
    cluster: Cluster,
    revenue_usd: float,
    ux_signals: list[float],
) -> dict | None:
    """POST raw signal data to a project's custom scoring plugin.

    Expects a JSON response with any of revenue_score/frequency_score/ux_score
    (0-1, Autopilot still applies the project's weights) or priority_score
    (0-1, a full override of the weighted combination). Returns None on any
    failure so the caller falls back to the internal formula.
    """
    import hashlib
    import hmac as hmac_lib
    import json as json_lib

    import httpx

    body = json_lib.dumps(
        {
            "cluster_id": str(cluster.id),
            "project_id": str(cluster.project_id),
            "title": cluster.title,
            "root_cause": cluster.root_cause,
            "revenue_usd": revenue_usd,
            "event_count": cluster.event_count,
            "affected_users": cluster.affected_users,
            "ux_signals": ux_signals,
            "max_revenue_usd": config.max_revenue_usd,
            "max_frequency_count": config.max_frequency_count,
        },
        default=str,
    ).encode()

    headers = {"Content-Type": "application/json"}
    if config.scoring_webhook_secret:
        signature = hmac_lib.new(config.scoring_webhook_secret.encode(), body, hashlib.sha256).hexdigest()
        headers["X-Autopilot-Signature"] = f"sha256={signature}"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(config.scoring_webhook_url, content=body, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            if not isinstance(data, dict):
                return None
            return data
    except Exception:
        logger.warning("Scoring webhook failed for project=%s, falling back to internal formula", cluster.project_id)
        return None


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

    cross_channel: bool = config.cross_channel

    # 3. Build summaries for all unclustered events, then batch-embed in one API call.
    #    Events that already have an embedding (from a previous partial run) are skipped.
    summaries: dict[uuid.UUID, str] = {
        e.id: _summarize_event(e, cross_channel=cross_channel) for e in unclustered
    }
    await _batch_embed_events(unclustered, summaries, db)
    await db.flush()  # Persist embeddings before the clustering loop reads them

    clusters_created = 0
    clusters_created_ids: set[uuid.UUID] = set()
    clusters_updated_ids: set[uuid.UUID] = set()

    # 4. Process each unclustered event using a three-tier decision:
    #    - similarity >= AUTO_ASSIGN  → pgvector confident match, no LLM
    #    - similarity <  AUTO_CREATE  → clearly new cluster, LLM names it only
    #    - between the two            → LLM tiebreaker (cross-source ambiguity)
    for event in unclustered:
        if not _is_negative_signal(event):
            continue

        summary = summaries[event.id]

        best_cluster, similarity = await _find_best_cluster(event, project_id, db)

        target = None
        create_kwargs: dict = {}

        if best_cluster and similarity >= _AUTO_ASSIGN_THRESHOLD:
            # High confidence — assign directly without LLM
            target = best_cluster

        elif best_cluster and similarity >= _AUTO_CREATE_THRESHOLD:
            # Ambiguous range — LLM decides, using only the single best candidate
            try:
                decision = await _llm_assign_or_create(
                    summary, best_cluster, cross_channel=cross_channel
                )
            except Exception:
                decision = {"action": "create", "title": f"{event.source}: {event.event_type}", "root_cause": summary[:200]}

            if decision.get("action") == "assign":
                cid = decision.get("cluster_id", "")
                if cid == str(best_cluster.id):
                    target = best_cluster
                # If LLM returned an unexpected ID, fall through to create below
            if target is None:
                create_kwargs = {
                    "title": decision.get("title", f"{event.source}: {event.event_type}"),
                    "root_cause": decision.get("root_cause", summary[:200]),
                }

        else:
            # No plausible cluster — LLM names the new cluster only
            try:
                naming = await _llm_name_cluster(summary)
                create_kwargs = {
                    "title": naming.get("title", f"{event.source}: {event.event_type}"),
                    "root_cause": naming.get("root_cause", summary[:200]),
                }
            except Exception:
                create_kwargs = {
                    "title": f"{event.source}: {event.event_type}",
                    "root_cause": summary[:200],
                }

        if target is None:
            target = Cluster(
                project_id=project_id,
                title=create_kwargs.get("title", f"{event.source}: {event.event_type}")[:200],
                root_cause=create_kwargs.get("root_cause", summary)[:500],
                first_seen=event.received_at,
                last_seen=event.received_at,
                event_count=0,
                affected_users=0,
            )
            db.add(target)
            await db.flush()

            # Regression detection — use the event's own embedding as provisional
            # cluster embedding so we can query resolved clusters immediately.
            if event.embedding is not None:
                target.embedding = event.embedding
                parent = await _detect_regression(target, db)
                if parent is not None:
                    target.parent_cluster_id = parent.id
                    parent.regression_count += 1

            clusters_created += 1
            clusters_created_ids.add(target.id)

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
    # Pass A (sequential): DB reads + scoring. SQLAlchemy async sessions don't
    # support concurrent queries on the same session, so this stays sequential.
    insight_work: list[tuple[Cluster, list[Event]]] = []
    scored_clusters: dict[uuid.UUID, Cluster] = {}

    for cluster_id in clusters_updated_ids:
        cluster = await db.get(Cluster, cluster_id)
        if not cluster:
            continue
        result = await db.execute(
            select(Event)
            .join(ClusterEvent, ClusterEvent.event_id == Event.id)
            .where(ClusterEvent.cluster_id == cluster_id)
        )
        cluster_events = result.scalars().all()

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

        await _rescore_cluster(cluster, config, cluster_events)
        scored_clusters[cluster_id] = cluster

        if cluster.event_count >= 2:
            insight_work.append((cluster, list(cluster_events)))

    # Pass B (parallel): LLM calls are independent across clusters — run concurrently.
    # Within each cluster regenerate_insight runs before pm_insight (pm_insight
    # uses the updated title/root_cause), so they stay sequential per cluster.
    async def _run_insights(cluster: Cluster, events: list[Event]) -> None:
        await _regenerate_insight(cluster, events, cross_channel)
        await _generate_pm_insight(cluster, events, config)

    if insight_work:
        await asyncio.gather(*[_run_insights(c, evts) for c, evts in insight_work])

    await db.commit()

    # Outbound webhooks — fire after commit so payloads reflect final state.
    # Fire-and-forget: never blocks or fails the evaluation pass.
    for cluster_id, cluster in scored_clusters.items():
        payload = cluster_payload(cluster)
        if cluster_id in clusters_created_ids:
            emit_event(project_id, EVENT_CLUSTER_CREATED, payload)
        emit_event(project_id, EVENT_CLUSTER_SCORED, payload)

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
                        emit_event(project_id, EVENT_CLUSTER_ISSUE_FILED, cluster_payload(cluster))
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
            emit_event(project_id, EVENT_CLUSTER_ISSUE_FILED, cluster_payload(cluster))
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
