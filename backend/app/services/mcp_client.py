"""Generic MCP server client using Streamable HTTP transport.

Pulls events from any MCP-compatible server. Deduplicates by SHA-256 hash
of the tool result so re-running a sync on unchanged data is a no-op.
"""
import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event


def _build_headers(
    auth_type: str,
    auth_value: str | None,
    auth_header_name: str | None,
) -> dict:
    if auth_type == "bearer" and auth_value:
        return {"Authorization": f"Bearer {auth_value}"}
    if auth_type == "header" and auth_header_name and auth_value:
        return {auth_header_name: auth_value}
    return {}


def _serialize_content(content: Any) -> Any:
    if hasattr(content, "text"):
        return content.text
    if hasattr(content, "model_dump"):
        return content.model_dump()
    return str(content)


async def discover_tools(
    server_url: str,
    auth_type: str = "none",
    auth_value: str | None = None,
    auth_header_name: str | None = None,
) -> list[dict]:
    """Connect to an MCP server and return its tool list."""
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    headers = _build_headers(auth_type, auth_value, auth_header_name)
    async with streamablehttp_client(server_url, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.list_tools()
            return [
                {"name": t.name, "description": t.description or ""}
                for t in result.tools
            ]


async def pull_mcp_server(
    server_url: str,
    selected_tools: list[str],
    project_id: uuid.UUID,
    integration_id: uuid.UUID,
    db: AsyncSession,
    auth_type: str = "none",
    auth_value: str | None = None,
    auth_header_name: str | None = None,
) -> int:
    """Call each selected tool and insert results as Event records.

    Skips tools whose result hash already exists in the DB.
    Returns the count of newly-inserted events.
    """
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client

    if not selected_tools:
        return 0

    headers = _build_headers(auth_type, auth_value, auth_header_name)
    now = datetime.now(timezone.utc)
    inserted = 0

    async with streamablehttp_client(server_url, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()

            for tool_name in selected_tools:
                try:
                    result = await session.call_tool(tool_name, {})
                except Exception:
                    continue

                content_data = [_serialize_content(c) for c in result.content]
                payload: dict[str, Any] = {
                    "tool": tool_name,
                    "content": content_data,
                    "is_error": bool(result.isError),
                }
                content_hash = hashlib.sha256(
                    json.dumps(payload, sort_keys=True, default=str).encode()
                ).hexdigest()
                payload["_hash"] = content_hash

                existing = await db.execute(
                    text(
                        """
                        SELECT id FROM events
                         WHERE project_id = :project_id
                           AND source = 'mcp'
                           AND event_type = :event_type
                           AND payload->>'_hash' = :hash
                         LIMIT 1
                        """
                    ),
                    {
                        "project_id": str(project_id),
                        "event_type": tool_name,
                        "hash": content_hash,
                    },
                )
                if existing.scalar_one_or_none() is not None:
                    continue

                db.add(
                    Event(
                        project_id=project_id,
                        integration_id=integration_id,
                        source="mcp",
                        event_type=tool_name,
                        payload=payload,
                        is_demo=False,
                        received_at=now,
                    )
                )
                inserted += 1

    if inserted:
        await db.flush()

    return inserted
