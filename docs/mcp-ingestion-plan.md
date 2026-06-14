# MCP Server Ingestion — Implementation Plan

Generic MCP client ingestion path. Users connect any MCP server (Stripe, Datadog,
custom enterprise) and Autopilot pulls events from it on a schedule. No public webhook
URL required — works fully locally.

## Files

| File | Change | Size |
|---|---|---|
| `backend/alembic/versions/0014_mcp_server.py` | New migration — add `mcp_server` to `IntegrationType` enum | XS |
| `backend/app/models/integration.py` | Add `mcp_server` to `IntegrationType` | XS |
| `backend/app/services/mcp_client.py` | New — `discover_tools`, `call_tool`, `pull_mcp_server` | M |
| `backend/app/api/integrations.py` | Two new endpoints: `/mcp/discover` and `/{id}/mcp-sync` | S |
| `backend/main.py` | Extend `background_mcp_puller` to handle `mcp_server` integrations | XS |
| `backend/requirements.txt` | Add `mcp>=1.0.0` | XS |
| `frontend/components/McpServerConfig.tsx` | New config panel component | M |
| `frontend/components/IntegrationsPanel.tsx` | Add MCP Server entry to `CATALOG` | XS |

## Design decisions

**Storage** — `config` JSONB holds `server_url`, `selected_tools[]`, `polling_interval_seconds`,
`auth_type` (bearer/header/none), `auth_header_name`, `last_mcp_sync`. Auth value goes in
`webhook_secret` (Fernet-encrypted, same as today).

**Transport** — Streamable HTTP only (stdio won't work in Docker). Hosted MCP servers
(e.g. `mcp.stripe.com`) work directly. Local servers must be reachable from the Docker network.

**Event shape** — `source = "mcp"`, `event_type = "<tool_name>"`, `payload = raw tool result`.
No changes to the evaluator, clustering, or analysis pipeline.

**Deduplication** — SHA-256 hash of tool result stored as `payload._hash`. Re-running a
sync on unchanged data is a no-op.

## Frontend UX (McpServerConfig)

1. Server URL input
2. Auth type selector (None / Bearer / Custom header)
3. Auth value (password input)
4. "Discover tools" → calls `/mcp/discover`, renders checklist of available tools
5. Selected tools persisted in `config.selected_tools`
6. Polling interval selector (5 min / 15 min / 1 hour)
7. Manual "Sync now" button + last synced timestamp

## Nothing changes in

- Webhook ingestion path
- Evaluator / clustering / scoring
- GitHub issue filing
- Ask AI
