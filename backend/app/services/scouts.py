"""Proactive scouts — scheduled, LLM-evaluated checks against MCP-connected sources.

Unlike plain MCP polling (services/mcp_client.py's pull_mcp_server, which
mirrors every selected tool's result into an Event verbatim on a shared
interval), a scout targets one tool with fixed arguments, runs on its own
schedule, and only creates an Event when an LLM evaluation step decides the
result is a genuine finding against the user's stated objective. This is the
proactive half of ingestion — reactive webhooks and blind polling wait for
something to arrive; a scout goes looking and only speaks up when it's worth
knowing, the same way a scheduled health check differs from a firehose.
"""
import json
import logging
import re
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.models.integration import Integration
from app.models.scout import ProjectScout
from app.services.llm import _parse_json, ai_chat
from app.services.mcp_client import call_mcp_tool
from app.services.outbox import enqueue_evaluation

logger = logging.getLogger(__name__)

_VALID_SEVERITIES = frozenset({"low", "medium", "high", "critical"})


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return slug[:60] or "scout"


async def run_scout(scout: ProjectScout, integration: Integration, db: AsyncSession) -> dict:
    """Run one scout: call its tool, evaluate the result, create an Event only
    if there's a genuine finding.

    Always sets scout.last_run_at. Never raises — every failure mode (missing
    config, unreachable MCP server, bad tool call, LLM/parse failure) is
    recorded on scout.last_error and returned as a non-notable result, so a
    broken scout degrades to "did nothing this run" rather than crashing the
    scheduler loop or the manual "run now" endpoint.

    Returns {"notable": bool, "summary": str | None, "error": str | None}.
    """
    now = datetime.now(timezone.utc)
    scout.last_run_at = now
    scout.last_error = None

    cfg = integration.config or {}
    server_url = cfg.get("server_url")
    if not server_url:
        scout.last_error = "Integration has no server_url configured"
        return {"notable": False, "summary": None, "error": scout.last_error}

    try:
        tool_result = await call_mcp_tool(
            server_url=server_url,
            tool_name=scout.tool_name,
            arguments=scout.tool_arguments or {},
            auth_type=cfg.get("auth_type", "none"),
            auth_value=integration.webhook_secret or None,
            auth_header_name=cfg.get("auth_header_name"),
        )
    except Exception as exc:
        scout.last_error = f"Tool call failed: {exc}"[:500]
        return {"notable": False, "summary": None, "error": scout.last_error}

    system_prompt = (
        "You are a proactive monitoring scout for a product-analytics tool. "
        "Given an objective the user configured and the raw result of a "
        "scheduled check against their data, decide whether this is worth "
        "surfacing as a finding a product manager or engineer should see "
        "right now. Most runs should NOT be notable — only flag genuine "
        "anomalies, degradations, or problems, not routine or healthy "
        "results. Respond only with JSON."
    )
    user_msg = f"""Objective: {scout.objective}

Tool result:
{json.dumps(tool_result, default=str)[:4000]}

Respond only with JSON:
{{"notable": <true|false>, "severity": "low"|"medium"|"high"|"critical", "summary": "<one sentence>", "details": "<2-3 sentences, cite specific numbers/fields from the data if notable>"}}"""

    try:
        response_text = await ai_chat(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.1,
        )
        verdict = _parse_json(response_text)
    except Exception as exc:
        scout.last_error = f"Evaluation failed: {exc}"[:500]
        return {"notable": False, "summary": None, "error": scout.last_error}

    if not verdict.get("notable"):
        return {"notable": False, "summary": verdict.get("summary"), "error": None}

    severity = verdict.get("severity", "medium")
    if severity not in _VALID_SEVERITIES:
        severity = "medium"

    payload = {
        "scout_id": str(scout.id),
        "scout_name": scout.name,
        "tool_name": scout.tool_name,
        "objective": scout.objective,
        "severity": severity,
        "summary": str(verdict.get("summary", ""))[:300],
        "details": str(verdict.get("details", ""))[:1000],
        "raw_result": tool_result,
    }

    db.add(Event(
        project_id=scout.project_id,
        integration_id=integration.id,
        source="scout",
        event_type=_slugify(scout.name),
        payload=payload,
        is_demo=False,
        received_at=now,
    ))
    scout.last_finding_at = now
    await db.flush()
    await enqueue_evaluation(scout.project_id, db)

    return {"notable": True, "summary": payload["summary"], "error": None}
