import asyncio
import json
import logging
import re
import random
import uuid
from datetime import datetime, timezone
from typing import Tuple

from openai import AsyncOpenAI, BadRequestError, RateLimitError
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import AsyncSessionLocal

logger = logging.getLogger(__name__)


def _make_openai(base_url: str | None = None, api_key: str = "", timeout: int | None = None) -> AsyncOpenAI:
    kwargs: dict = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    if timeout is not None:
        kwargs["timeout"] = timeout
    return AsyncOpenAI(**kwargs)


def _ai_client() -> Tuple[AsyncOpenAI, str, bool]:
    """Returns (client, model, is_local). Prefers LM Studio when LM_STUDIO_URL is set."""
    if settings.LM_STUDIO_URL:
        return (
            _make_openai(
                base_url=settings.LM_STUDIO_URL,
                api_key="lm-studio",
                timeout=settings.LM_STUDIO_TIMEOUT,
            ),
            settings.LM_STUDIO_MODEL or "local-model",
            True,
        )
    return _make_openai(api_key=settings.OPENAI_API_KEY), "gpt-5-nano-2025-08-07", False


def _parse_json(text: str) -> dict:
    """Extract JSON from a response that may be wrapped in markdown code blocks."""
    text = text.strip()
    # Strip ```json ... ``` or ``` ... ```
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


async def ai_chat(
    messages: list[dict],
    temperature: float = 0.3,
    json_mode: bool = True,
) -> str:
    """Call the primary AI model and return the content string.

    Falls back to Gemini (via its OpenAI-compatible endpoint) if the primary
    call fails and GEMINI_API_KEY is configured.
    Set json_mode=False for plain-text responses (e.g. chat).
    """
    client, model, is_local = _ai_client()
    kwargs = {} if is_local or not json_mode else {"response_format": {"type": "json_object"}}
    logger.info("AI call → model=%s", model)
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            **kwargs,
        )
        logger.info("AI call ✓ model=%s", model)
        return response.choices[0].message.content
    except BadRequestError as e:
        # Some models (e.g. gpt-5-nano, o-series) only support default temperature.
        # Retry once without the temperature parameter.
        if "temperature" in str(e) and "unsupported_value" in str(e):
            logger.info("Model %s does not support temperature=%.1f, retrying with default", model, temperature)
            response = await client.chat.completions.create(
                model=model,
                messages=messages,
                **kwargs,
            )
            logger.info("AI call ✓ model=%s (default temperature)", model)
            return response.choices[0].message.content
        logger.warning("AI call failed for model %s: %s", model, e)
        if not settings.GEMINI_API_KEY:
            raise
        logger.info("Falling back to Gemini (%s)", settings.GEMINI_MODEL)
    except RateLimitError as e:
        logger.warning("AI rate limit / quota exceeded for model %s: %s", model, e)
        if not settings.GEMINI_API_KEY:
            raise
        logger.info("Falling back to Gemini (%s)", settings.GEMINI_MODEL)
    except Exception as e:
        logger.warning("AI call failed for model %s: %s", model, e)
        if not settings.GEMINI_API_KEY:
            raise
        logger.info("Falling back to Gemini (%s)", settings.GEMINI_MODEL)

    gemini = _make_openai(
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        api_key=settings.GEMINI_API_KEY,
    )
    logger.info("AI call → model=%s (Gemini fallback)", settings.GEMINI_MODEL)
    gemini_kwargs: dict = {} if not json_mode else {"response_format": {"type": "json_object"}}
    try:
        response = await gemini.chat.completions.create(
            model=settings.GEMINI_MODEL,
            messages=messages,
            temperature=temperature,
            **gemini_kwargs,
        )
        logger.info("AI call ✓ model=%s (Gemini fallback)", settings.GEMINI_MODEL)
        return response.choices[0].message.content
    except RateLimitError as e:
        logger.error("Gemini rate limit / quota exceeded: %s", e)
        raise
    except Exception as e:
        logger.error("Gemini fallback also failed: %s", e)
        raise

# Scenarios are grouped into 4 cross-source crisis themes so events from different
# sources describe the same underlying incident and cluster together tightly.
#
# Theme A — Checkout/Payment meltdown
# Theme B — Enterprise subscription renewal failures
# Theme C — Invoice portal & PDF generation outage
# Theme D — Premium feature degradation causing churn risk

STRIPE_SCENARIOS = [
    # Theme A: Checkout meltdown — mass payment failures at the moment of purchase
    "A surge of enterprise checkout sessions is failing: payment_intent.payment_failed for "
    "multiple high-value customers, amounts ranging from $12,000 to $85,000. "
    "Stripe retries are exhausting without success.",

    # Theme B: Enterprise renewal failures — large annual contracts going past_due
    "Several enterprise annual subscription invoices ($18,000–$95,000) have failed renewal. "
    "Subscriptions entered past_due status; one customer already disputed a prior charge. "
    "Automatic retries failed twice.",

    # Theme C: Invoice payment failures and refund demands
    "Three enterprise customers have filed invoice disputes totalling over $120,000 after "
    "being double-charged. Refund requests are pending. One high-value subscription is at "
    "risk of cancellation.",

    # Theme D: Subscription downgrades after feature outage
    "Six enterprise customers downgraded from the $15,000/yr plan citing a broken premium "
    "feature. Two more have requested full refunds ($24,000 and $36,000) with churn risk noted "
    "in their accounts.",
]

SENTRY_SCENARIOS = [
    # Theme A: Payment service errors during checkout
    "A NullPointerException in PaymentService.processCheckout() is throwing for every third "
    "checkout attempt. The error is caught but returns a 500 to the client, silently failing "
    "payment confirmation. Affects all customers in production.",

    # Theme B: Subscription renewal job crashing
    "The nightly subscription renewal background job is crashing with a DatabaseTimeoutError "
    "after processing ~40% of enterprise invoices. The remaining 60% are left unprocessed, "
    "triggering Stripe's automatic retry logic unnecessarily.",

    # Theme C: Invoice PDF generation service down
    "The invoice PDF generation endpoint (/api/invoices/:id/pdf) is throwing an "
    "UnhandledPromiseRejection — the underlying wkhtmltopdf process is segfaulting. "
    "All invoice download requests are returning 500.",

    # Theme D: Feature flag service errors for premium tier
    "The feature flag evaluation service is returning null for the 'enterprise_features' "
    "flag segment. Premium-tier users receive a FeatureFlagError and lose access to "
    "advanced analytics, SSO, and API rate-limit overrides.",
]

FULLSTORY_SCENARIOS = [
    # Theme A: Rage-clicks on checkout payment button
    "Enterprise users are rage-clicking the 'Complete Purchase' button on /checkout/payment "
    "after card validation silently fails. Click counts of 8–15 per session indicate extreme "
    "frustration before users abandon.",

    # Theme B: Dead-clicks on 'Renew Subscription' CTA
    "High-value users are dead-clicking 'Renew Now' on /billing/subscription — the button "
    "renders but the click handler is missing after a deploy. Users thrash then navigate away, "
    "signalling imminent churn.",

    # Theme C: Error-clicks on invoice download
    "Users are clicking 'Download Invoice' on /billing/invoices repeatedly and receiving "
    "error toasts. Sessions show 6–12 frustrated clicks before users open a support chat. "
    "Affects the entire /billing/invoices/* path.",

    # Theme D: Thrash on premium feature pages after access loss
    "Enterprise users are thrashing between /features/analytics and /upgrade after losing "
    "access to premium features mid-session. Sessions terminate with support widget open, "
    "indicating escalation intent.",
]

ZENDESK_SCENARIOS = [
    # Theme A: Cannot complete checkout — payment failures
    "Multiple enterprise customers have opened URGENT tickets reporting that their team cannot "
    "complete purchases. One customer mentions a $50,000 contract order stuck at the payment "
    "step for 2 hours. CS team is manually escalating.",

    # Theme B: Subscription lapsed, team locked out of paid features
    "An enterprise customer with 200 seats reports their subscription lapsed despite having "
    "valid payment on file. Their entire team lost access to the product overnight. "
    "Customer is threatening cancellation of their $72,000/yr contract.",

    # Theme C: Invoice history missing and double-charge dispute
    "Three enterprise accounts are disputing duplicate invoice charges. One customer reports "
    "being charged twice for a $45,000 annual contract. Invoice history shows blank for all "
    "affected accounts — customers cannot download receipts for accounting.",

    # Theme D: Enterprise features broken after update
    "Six enterprise customers opened tickets within 90 minutes reporting that SSO, advanced "
    "reporting, and API access stopped working simultaneously after last night's deploy. "
    "Two customers explicitly mentioned evaluating competitors.",
]

SYSTEM_PROMPT = """You are a webhook payload generator for a SaaS observability demo.
Generate realistic webhook events in the exact format the provider uses.
Return only valid JSON, no markdown, no explanation."""


async def generate_demo_events(
    source: str,
    context_events: list[dict] | None = None,
) -> list[dict]:
    if source == "stripe":
        scenario = random.choice(STRIPE_SCENARIOS)
        format_rules = """Stripe webhook format rules:
- id: "evt_<random alphanum>", object: "event", api_version: "2024-06-20", livemode: false
- type: matches event_type field
- data.object: the Stripe resource (PaymentIntent, Subscription, Invoice, etc.)
- data.object must include: id (pi_xxx / sub_xxx / in_xxx), object, amount, currency,
  customer ("cus_<id>"), status, metadata: {user_id, email}
- created: Unix timestamp
- IMPORTANT: This is an enterprise SaaS product. Use realistic enterprise contract amounts:
  amount values must be in CENTS and range from 1200000 to 9500000 (i.e. $12,000–$95,000).
  Use failure/at-risk event types only — do NOT generate payment_intent.succeeded or
  customer.subscription.created events."""
        event_count = "6-8"
        event_types = "payment_intent.payment_failed, invoice.payment_failed, customer.subscription.updated (to past_due), charge.dispute.created, invoice.payment_action_required"

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
- data.issue: {id, title, culprit, status: "unresolved", level: "error"}
- Use level: "error" or "fatal" — never "info" or "debug"."""
        event_count = "5-7"
        event_types = "event.alert, issue.created"

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
  }
- Prefer rage_click and error_click — these are the strongest frustration signals."""
        event_count = "5-7"
        event_types = "rage_click, error_click, dead_click, thrash"

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
- event: {"meta": {"sequence": {"id": <large int>, "position": 1}}}
- Use priority "URGENT" or "HIGH" — never "NORMAL" or "LOW".
- type should be "PROBLEM" or "INCIDENT"."""
        event_count = "4-5"
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

    text = await ai_chat(
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.9,
    )

    data = _parse_json(text)
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
