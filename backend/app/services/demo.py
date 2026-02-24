import json
import re
import random
from typing import Tuple

from openai import AsyncOpenAI

from app.config import settings


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

    else:  # fullstory
        scenario = random.choice(FULLSTORY_SCENARIOS)
        format_rules = """FullStory webhook format rules:
- eventName: the event type string
- version: 1
- data: {
    session_id: "fs_sess_<alphanum>",
    session_url: "https://app.fullstory.com/ui/ORG/page/People/<user_id>/Segments/mine/Session/<session_id>",
    user_id: "<user_id>",
    user_email: "<email>",
    user_display_name: "<name>",
    event_time: ISO-8601,
    page_url: "https://app.example.com/<path>",
    target_text: "<button or element text>",
    element_name: "<element identifier>",
    frustration_type: "rage_click" | "dead_click" | "error_click" | "thrash" | null,
    click_count: <int, relevant for rage_click>,
    session_duration_seconds: <int>
  }"""
        event_count = "3-5"
        event_types = "e.g. rage_click, dead_click, error_click, session_start, session_end, custom_event"

    # Build correlation context if we have events from other sources
    correlation_section = ""
    if context_events:
        if source == "fullstory":
            other_label = "Stripe/Sentry"
        elif source == "stripe":
            other_label = "Sentry/FullStory"
        else:
            other_label = "Stripe/FullStory"
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
