import asyncio
import json
import re
import random
import uuid
from datetime import datetime, timezone
from typing import Tuple

from openai import AsyncOpenAI
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import AsyncSessionLocal


def _ai_client() -> Tuple[AsyncOpenAI, str, bool]:
    """Returns (client, model, is_local). Prefers LM Studio when LM_STUDIO_URL is set."""
    if settings.LM_STUDIO_URL:
        return (
            AsyncOpenAI(
                base_url=settings.LM_STUDIO_URL,
                api_key="lm-studio",
                timeout=settings.LM_STUDIO_TIMEOUT,
            ),
            settings.LM_STUDIO_MODEL or "local-model",
            True,
        )
    return AsyncOpenAI(api_key=settings.OPENAI_API_KEY), "gpt-4o-mini", False


def _parse_json(text: str) -> dict:
    """Extract JSON from a response that may be wrapped in markdown code blocks."""
    text = text.strip()
    # Strip ```json ... ``` or ``` ... ```
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return json.loads(text)

STRIPE_SCENARIOS = [
    "A customer's payment fails due to insufficient funds. Retries also fail.",
    "A new customer completes their first subscription purchase.",
    "A customer upgrades from a free plan to a paid plan mid-cycle.",
    "A customer's card expires and their subscription enters past_due status.",
    "A high-value customer requests a refund after a failed feature rollout.",
]

SENTRY_SCENARIOS = [
    "An unhandled exception occurs in the payment processing service.",
    "A database connection timeout spikes during a traffic surge.",
    "A feature flag service throws a null-pointer error for premium users.",
    "An API rate-limit error cascades into a queue backlog.",
    "A background job fails silently and starts producing corrupt output.",
]

FULLSTORY_SCENARIOS = [
    "Users repeatedly rage-click the checkout button after a payment form validation error.",
    "Dead clicks on a disabled 'Upgrade Plan' CTA reveal a broken feature flag for free-tier users.",
    "Users thrash the navigation menu during a slow API response, then abandon the session.",
    "Error clicks on the invoice download button expose a broken PDF generation endpoint.",
    "A cohort of high-value users exhibit frustration signals on the billing settings page after a price change.",
]

ZENDESK_SCENARIOS = [
    "A customer opens an urgent ticket because they can't complete a payment at checkout.",
    "Multiple customers report being unable to access their account after a backend deployment.",
    "A high-value customer files a ticket about an incorrect charge on their invoice.",
    "A batch of users reports the upgrade flow is broken and they can't access paid features.",
    "Customers complain about slow load times on the billing settings page and missing invoice history.",
]

SYSTEM_PROMPT = """You are a webhook payload generator for a SaaS observability demo.
Generate realistic webhook events in the exact format the provider uses.
Return only valid JSON, no markdown, no explanation."""


async def generate_demo_events(
    source: str,
    context_events: list[dict] | None = None,
) -> list[dict]:
    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

    if source == "stripe":
        scenario = random.choice(STRIPE_SCENARIOS)
        format_rules = """Stripe webhook format rules:
- id: "evt_<random alphanum>", object: "event", api_version: "2024-06-20", livemode: false
- type: matches event_type field
- data.object: the Stripe resource (PaymentIntent, Subscription, Invoice, etc.)
- data.object must include: id (pi_xxx / sub_xxx / in_xxx), object, amount, currency,
  customer ("cus_<id>"), status, metadata: {user_id, email}
- created: Unix timestamp"""
        event_count = "3-4"
        event_types = "e.g. payment_intent.payment_failed, payment_intent.succeeded, customer.subscription.updated, invoice.payment_failed"

    elif source == "sentry":
        scenario = random.choice(SENTRY_SCENARIOS)
        format_rules = """Sentry webhook format rules:
- action: "triggered" or "created"
- actor: {type: "application", id: "sentry", name: "Sentry"}
- data.event: {event_id (UUID), project, platform ("python"/"node"), release,
    exception.values: [{type, value, stacktrace: {frames: [{filename, function, lineno}]}}],
    user: {id, email},
    tags: [["customer_id","cus_xxx"], ["environment","production"]],
    timestamp: ISO-8601}
- data.issue: {id, title, culprit, status: "unresolved", level: "error"}"""
        event_count = "3-4"
        event_types = "e.g. event.alert, issue.created, issue.resolved"

    elif source == "fullstory":
        scenario = random.choice(FULLSTORY_SCENARIOS)
        format_rules = """FullStory webhook format rules (confirmed real schema):
- eventName: the event type string (e.g. "rage_click", "dead_click", "error_click", "thrash")
- version: 1
- data: {
    pageInfo: {
      pageUrl: "https://app.example.com/<path>",
      referrer: "https://app.example.com/<previous_path>",
      country: "US",
      ipAddress: "<ip>"
    },
    sessionUrl: "https://app.fullstory.com/ui/ORG/session/<session_id>",
    userUrl: "https://app.fullstory.com/ui/ORG/segments/everyone/people/0/user/<user_id>",
    frustration_type: "rage_click" | "dead_click" | "error_click" | "thrash",
    target_text: "<button or element text>",
    click_count: <int, relevant for rage_click>,
    user_id: "<app user id>",
    user_email: "<user email address>"
  }"""
        event_count = "3-5"
        event_types = "rage_click, dead_click, error_click, thrash"

    else:  # zendesk
        scenario = random.choice(ZENDESK_SCENARIOS)
        format_rules = """Zendesk webhook format rules (real schema v2022-11-06):
- type: "zen:event-type:ticket.created" or "zen:event-type:ticket.updated"
- account_id: <integer>
- id: "<UUID>"
- time: ISO-8601 with nanoseconds (e.g. "2025-01-08T10:12:07.672717030Z")
- zendesk_event_version: "2022-11-06"
- subject: "zen:ticket:<ticket_id>" (resource URI — NOT the human ticket subject)
- detail: {
    id: "<ticket_id as string>",
    subject: "<short human-readable ticket subject>",
    description: "<detailed problem description, 1-2 sentences>",
    status: "NEW" | "OPEN" | "PENDING",
    priority: "URGENT" | "HIGH" | "NORMAL" | "LOW",
    type: "PROBLEM" | "INCIDENT" | "QUESTION" | "TASK",
    tags: ["relevant", "topic", "tags"],
    created_at: ISO-8601,
    updated_at: ISO-8601,
    requester_id: "<integer as string>",
    external_id: "<app-side user_id if developer set it, else null>",
    submitter_id: "<integer as string>",
    assignee_id: "<integer as string>",
    organization_id: "<integer as string or null>",
    is_public: true,
    via: {"channel": "web_service" | "email" | "api"}
  }
- event: {"meta": {"sequence": {"id": <large int>, "position": 1}}}"""
        event_count = "2-3"
        event_types = "zen:event-type:ticket.created, zen:event-type:ticket.updated"

    # Build correlation context if we have events from other sources
    correlation_section = ""
    if context_events:
        all_sources = {"stripe", "sentry", "fullstory", "zendesk"}
        other_label = "/".join(s.capitalize() for s in sorted(all_sources - {source}))
        correlation_section = f"""
IMPORTANT — Correlation required:
These recent {other_label} events already exist in the system. Extract the customer identifiers
from them and reuse the SAME values (user_email, user_id, cus_xxx) in your generated payloads
so the events are cross-source correlatable.

Existing {other_label} events for context:
{json.dumps(context_events, indent=2, default=str)}
"""

    prompt = f"""Generate {event_count} realistic {source.capitalize()} webhook events for this scenario:
"{scenario}"

{format_rules}
{correlation_section}
Return JSON: {{"events": [
  {{"source": "{source}", "event_type": "<type>", "payload": {{...}}}}
]}}

Event types to use: {event_types}
Use realistic IDs. Timestamps within a 2-minute window.
"""

    client, model, is_local = _ai_client()
    kwargs = {} if is_local else {"response_format": {"type": "json_object"}}

    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.9,
        **kwargs,
    )

    data = _parse_json(response.choices[0].message.content)
    if isinstance(data, list):
        return data
    return data.get("events", [])


async def _bg_evaluate(project_id: uuid.UUID) -> None:
    """Run evaluate_project in a fresh session; safe as an asyncio background task."""
    from app.services.evaluator import evaluate_project
    try:
        async with AsyncSessionLocal() as db:
            await evaluate_project(project_id, db)
    except Exception:
        pass


async def simulate_active_projects(db: AsyncSession) -> None:
    """Generate one batch of demo events for every project that has simulation enabled."""
    from app.models.event import Event
    from app.models.project import Project
    from app.models.scoring_config import ProjectScoringConfig

    result = await db.execute(
        select(ProjectScoringConfig, Project)
        .join(Project, Project.id == ProjectScoringConfig.project_id)
        .where(
            or_(
                ProjectScoringConfig.simulate_stripe.is_(True),
                ProjectScoringConfig.simulate_sentry.is_(True),
                ProjectScoringConfig.simulate_fullstory.is_(True),
                ProjectScoringConfig.simulate_zendesk.is_(True),
            )
        )
    )
    rows = result.all()

    for config, project in rows:
        sources = (
            (["stripe"]    if config.simulate_stripe    else []) +
            (["sentry"]    if config.simulate_sentry    else []) +
            (["fullstory"] if config.simulate_fullstory else []) +
            (["zendesk"]   if config.simulate_zendesk   else [])
        )

        inserted_any = False
        for source in sources:
            other_sources = [s for s in ("stripe", "sentry", "fullstory", "zendesk") if s != source]
            ctx_result = await db.execute(
                select(Event)
                .where(Event.project_id == project.id, Event.source.in_(other_sources))
                .order_by(Event.received_at.desc())
                .limit(3)
            )
            context = [
                {"source": e.source, "event_type": e.event_type, "payload": e.payload}
                for e in ctx_result.scalars().all()
            ]

            try:
                events_data = await generate_demo_events(source=source, context_events=context or None)
            except Exception:
                continue

            now = datetime.now(timezone.utc)
            for e in events_data:
                db.add(Event(
                    id=uuid.uuid4(),
                    project_id=project.id,
                    integration_id=None,
                    source=e.get("source", source),
                    event_type=e.get("event_type", "demo.event"),
                    payload=e.get("payload", {}),
                    is_demo=True,
                    received_at=now,
                ))
            inserted_any = True

        if inserted_any:
            try:
                await db.commit()
                asyncio.create_task(_bg_evaluate(project.id))
            except Exception:
                await db.rollback()
