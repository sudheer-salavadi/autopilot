# Platform vision — Autopilot as the "Android" of self-driving product management

Read this before starting any new session on the coding-agent / signal-source /
orchestration parts of Autopilot. It captures the strategic bet behind several
recent features and the roadmap that follows from it, so the reasoning doesn't
have to be re-derived from scratch every session.

## The comparison that motivates this

Some competing "self-driving product management" tools take a vertically
integrated approach: signals come from their own first-party tracker (their
own error tracking, session replay, logs, health checks, plus a handful of
external trackers), group into reports, an agent investigates each report,
opens a PR for the actionable ones, and a post-merge check feeds the result
back as a new signal. That loop is **iOS-style**: best-in-class if you run
their tracker and their agent, closed if you don't.

Autopilot's bet is the opposite: be the **Android** of this space — don't own
the tracker or the agent, own the layer in between (ingest → cluster by root
cause → score by business impact → recommend → orchestrate a fix) and make
every layer above and below it swappable. Win by being the neutral hub that
plugs into whatever stack a team already has, not by forcing them onto ours.

## Strategic pillars — current state

| Pillar | What "Android-like" means here | Status |
|---|---|---|
| **Signal sources** | Any tool can feed events in, not just named integrations | Partial — Stripe/Sentry/FullStory/Zendesk webhooks + generic MCP polling (`services/mcp_client.py`). MCP is the real "USB-C" here; named integrations are reference implementations, not the ceiling. |
| **Fix agents** | Any coding agent can be triggered, not one owned agent | Done — provider registry in `services/coding_agents.py` + user-extensible `ProjectAgentConfig` (custom providers via `POST /agent-config`, not just the 3 built-ins). |
| **LLM for the core pipeline** | BYO model for clustering/scoring/embeddings/Ask AI | Done — `services/llm.py` resolves `AI_BASE_URL` (any OpenAI-compatible endpoint: LM Studio, Ollama, vLLM, OpenRouter, ...) first, `OPENAI_API_KEY` as the zero-config default, Gemini as failure-only fallback. Embedding model + vector dimension configurable via `AI_EMBEDDING_MODEL`/`AI_EMBEDDING_DIMS`. |
| **Proactive scouts** | Generic scheduled-probe interface, not just reactive webhooks | Done — `services/scouts.py` + `ProjectScout`: a named check against one MCP tool, own schedule, own LLM-evaluated objective. Only creates an event when there's a genuine finding, unlike plain MCP sync which mirrors everything. See below. |
| **Open pipeline APIs** | Each stage (ingest/cluster/score/recommend/file/fix) independently addressable by third parties | Done — outbound webhooks on every stage transition (`services/webhook_dispatch.py`) plus a pluggable scoring webhook that can replace the score stage's logic entirely. See below. |
| **Self-hosting** | No forced cloud dependency | Done — Docker Compose, `SKIP_AUTH=true` for zero-config local runs. |

## Roadmap (priority order, as of 2026-07-02)

1. ~~User-extensible coding-agent providers~~ — done
2. ~~BYO LLM for the core pipeline~~ — done
3. ~~Generic scout interface~~ — done, see below
4. ~~Open pipeline APIs / stage-level extensibility~~ — done, see below. Shipped ahead of #3 by explicit request.

All four original roadmap items are now shipped. Next up, requested
separately: an evaluation of the **clustering/scoring logic itself**
(`services/evaluator.py`) — whether assign-vs-create decisions and the
default priority formula actually produce correct groupings and correct
"most critical first" ranking, not just whether the plumbing is pluggable.
That work is being scoped in its own session/prompt rather than folded in
here, deliberately sequenced *after* scouts: scouts add signal volume through
the same clustering/scoring engine, so fixing that engine's correctness
first means scouts (and every future signal source) inherit the fix for
free, rather than needing re-validation once clustering changes land.

## Shipped: BYO LLM for the core pipeline

**Why:** README used to say "OpenAI is required... there is no substitute" for
clustering, scoring, embeddings, and Ask AI, with local models (LM Studio)
documented as Simulate-mode-only. That was actually stale — the chat-completion
path (`ai_chat`, formerly living in `services/demo.py`) already preferred
LM Studio when configured, for every caller including the real evaluator and
Ask AI, not just demo-event generation. The genuine gap was narrower than the
docs implied: embeddings were unconditionally OpenAI, and the config/docs
made the whole thing look hard-locked when most of it wasn't.

**What changed:**
- New `services/llm.py` is now the single place that constructs model
  clients. `primary_client()` resolves `AI_BASE_URL` + `AI_MODEL` (any
  OpenAI-compatible endpoint) first, falls back to `OPENAI_API_KEY` as the
  zero-config default. `ai_chat()` still falls back to Gemini only on
  failure — never the primary path. `LM_STUDIO_URL`/`LM_STUDIO_MODEL` are
  kept as back-compat aliases for `AI_BASE_URL`/`AI_MODEL` so existing `.env`
  files don't break.
- `embedding_client()` uses the same `AI_BASE_URL` resolution, so a fully
  local deployment (e.g. Ollama for both chat and embeddings) needs no cloud
  key at all. Model name is `AI_EMBEDDING_MODEL` (default
  `text-embedding-3-small`).
- The vector column dimension was hardcoded to 1536 in both `Cluster.embedding`
  and `Event.embedding` — a real constraint, not just a doc issue, since
  pgvector enforces exact dimension match and local embedding models rarely
  emit 1536 dims. Made configurable via `AI_EMBEDDING_DIMS`, read by both the
  SQLAlchemy models and a new migration (`0018`) that resizes the columns
  (nulling stale embeddings) when it differs from the previous default.
  **Known limitation:** changing `AI_EMBEDDING_DIMS` a second time after
  `0018` has already run needs a manual `ALTER TABLE` — Alembic migrations
  don't re-run when config changes. Fine for "pick a model once per
  deployment," not for hot-swapping embedding providers.
- `evaluator.py`, `chat.py`, and `demo.py` now import from `llm.py` instead of
  each other; `demo.py` is back to being Simulate-content-generation only.

**Files touched:** `config.py`, `services/llm.py` (new), `services/demo.py`,
`services/evaluator.py`, `api/chat.py`, `models/event.py`, `models/cluster.py`,
`alembic/versions/0018_configurable_embedding_dims.py`, README, `.env.example`.

## Shipped: user-extensible coding-agent providers

**Why:** the fix-trigger feature (shipped) hardcodes exactly three vendors in
`PROVIDERS` (`services/coding_agents.py`). That's the most iOS-like part of an
otherwise-open feature — new agents require an Autopilot code change and
release. Making providers user-defined data instead of registry-code closes
that gap and is cheap relative to items 2–4 above.

**Design:**
- `ProjectAgentConfig` gains `name`, `setup_docs_url` (both nullable — null on
  a built-in row means "inherit from the `PROVIDERS` registry"), and
  `is_custom` (bool, set once at creation, drives whether the row can be
  deleted vs. only disabled).
- The three built-in providers keep working exactly as before (registry entry
  is the fallback for name/template/docs when the DB row doesn't override
  them) — this is additive, not a breaking change.
- A project can additionally `POST /agent-config` with an arbitrary slug,
  display name, trigger comment template, and optional docs link. Built-in
  slugs (`claude`/`codex`/`gemini`) are reserved and rejected for custom rows.
- `DELETE /agent-config/{provider}` removes a custom row; built-ins 400 with
  a message pointing at disabling instead (they can't be deleted, only
  toggled off, since the registry entry always exists).
- `trigger_agent_fix` stops requiring `PROVIDERS` membership — it looks up the
  `ProjectAgentConfig` row directly (works identically for built-in and
  custom) and uses whatever `name`/`trigger_template` it resolves to.
- Frontend `ClustersFeed.tsx`'s "Fix with…" dropdown already renders whatever
  the `/agent-config` endpoint returns — it needed **no changes** to support
  custom providers, which is a good sign the earlier design was already
  data-driven rather than hardcoded to three names.

**Files touched:** `models/agent_config.py`, a new alembic migration,
`schemas/agent_config.py`, `api/agent_config.py`, `components/CodingAgentsConfig.tsx`.

## Shipped: independently addressable pipeline stages

**Why:** ingest → cluster → score → recommend → file issue → trigger fix was
one closed flow inside the FastAPI app — a third party could only read final
state via the REST API (polling), and nothing let them replace a stage's
internal logic. Two concrete asks drove the scope: a Slack app that reads
clusters (needs push, not polling) and a custom scoring plugin (needs a stage
override, not just an event).

**What changed:**
- New `services/webhook_dispatch.py` is a generic outbound-event bus.
  `emit_event(project_id, event_type, payload)` is fire-and-forget — it
  schedules delivery on its own `asyncio.create_task` with its own DB
  session, so a slow or dead third-party endpoint never blocks the pipeline
  stage that called it. Six event types cover the stage transitions:
  `cluster.created`, `cluster.scored`, `cluster.issue_filed`,
  `cluster.fix_requested`, `cluster.fix_pr_linked`, `cluster.resolved`.
- `ProjectWebhookSubscription` (new table) lets a project register any number
  of `(url, event_types[], secret)` subscriptions via
  `POST/PATCH/DELETE /webhook-subscriptions`, plus a `/test` endpoint for a
  synchronous ping delivery. Deliveries are HMAC-SHA256 signed
  (`X-Autopilot-Signature`) using the same scheme Autopilot's own inbound
  webhook verification already uses (`services/webhooks.py`) — consistent
  with, not a departure from, the existing pattern.
- `emit_event` calls are wired into every stage's success path: cluster
  creation/scoring in `evaluator.py`'s `evaluate_project`, issue filing in
  both the manual endpoint and `_autopilot_github`, fix-trigger in
  `agent_config.py`, PR-linking and resolution in `webhooks.py`, and manual
  status changes in `clusters.py`.
- `_rescore_cluster` (the score stage) is now genuinely pluggable: if
  `ProjectScoringConfig.scoring_webhook_url` is set, raw signal data is
  POSTed (HMAC-signed) and the returned `revenue_score`/`frequency_score`/
  `ux_score` (still combined with the project's configured weights) or a
  direct `priority_score` override is used instead of the internal formula.
  Any failure falls back to the internal formula — same graceful-degradation
  posture as the coding-agent and LLM work before it.
- Both webhook secrets (`ProjectWebhookSubscription.secret`,
  `ProjectScoringConfig.scoring_webhook_secret`) are `EncryptedString`
  (Fernet, same as `Integration.webhook_secret`) — encrypted at rest,
  decrypted transparently on read.

**Known limitations, by design:**
- No retry queue — a delivery that fails once is not retried. The
  "last_delivery_status/error" fields on each subscription are the debugging
  surface; there's no dead-letter handling.
- Only the score stage has a plug-in override point. Recommend/file-issue/
  trigger-fix could follow the same override pattern later, but weren't
  built speculatively — the two concrete use cases (Slack notifications,
  custom scoring) drove exactly two mechanisms, not a generic framework for
  every stage.

**Files touched:** `models/webhook_subscription.py` (new),
`models/scoring_config.py`, `services/webhook_dispatch.py` (new),
`services/evaluator.py`, `api/webhook_subscriptions.py` (new),
`api/scoring_config.py`, `api/clusters.py`, `api/webhooks.py`,
`api/github_config.py`, `api/agent_config.py`, `schemas/webhook_subscription.py`
(new), `schemas/scoring_config.py`, `alembic/versions/0019_stage_extensibility.py`,
`components/WebhooksConfig.tsx` (new), `components/PrioritizationConfig.tsx`,
`components/IntegrationsPanel.tsx`, README.

## Shipped: proactive scouts

**Why:** every existing signal source was reactive (a webhook push) or blind
polling (`services/mcp_client.py`'s `pull_mcp_server` mirrors every selected
tool's result into an event verbatim, on one shared per-integration
interval, no interpretation). Neither is "proactive detection" — a
vertically-integrated competitor gets that by owning a tracker and scanning
it (session replay, SDK health checks); the generic answer for a
bring-your-own-source platform is a scheduled *check* against a source that
only speaks up when something's actually wrong.

**What changed:**
- New `ProjectScout` (one row per named check): targets one tool on an
  existing `mcp_server` `Integration`, with fixed `tool_arguments`, its own
  `interval_seconds` (independent of that integration's own sync interval),
  and a free-text `objective` — what the user is watching for.
- `services/scouts.py`'s `run_scout()` is the whole mechanism: call the tool
  via a new `call_mcp_tool()` helper in `mcp_client.py` (a single-tool,
  single-session variant of the bulk poller's connection logic), then ask
  the configured LLM (`services/llm.py`'s `ai_chat`, so this is BYO-model
  like everything else) whether the result is "notable" against the
  objective, with what severity. An `Event(source="scout")` is only created
  when the verdict says yes — most runs should produce nothing, by design.
  A found event flows through the exact same clustering/scoring/webhook
  pipeline as any other event; there's no special-cased "scout path."
- New `sources/scout.py` plugin: `is_negative` is always `True` (the LLM
  step already filtered for notability before the event exists), `ux_signal`
  maps the LLM's own severity verdict (low/medium/high/critical) to a 0–1
  score rather than recomputing it.
- Scheduling: `background_scout_runner` in `main.py`, same due-check
  pattern as `background_mcp_puller` (`last_run_at + interval_seconds <=
  now`) but per-scout instead of per-integration, since each scout has its
  own cadence.
- Every failure mode (missing server config, unreachable MCP server, bad
  tool call, LLM/parse failure) is caught and recorded on
  `scout.last_error` — a broken scout degrades to "did nothing this run,"
  never crashes the scheduler or the manual "Run now" endpoint.
- Frontend: `ScoutsConfig.tsx`, nested inside `McpServerConfig.tsx` (a scout
  is meaningless without a connected MCP integration to target) — list,
  add (tool picker from already-discovered tools, JSON arguments, objective
  textarea, interval picker), run-now with immediate result, last
  run/finding timestamps, per-scout enable toggle.

**Known limitation, by design:** a scout can only target an MCP-connected
source, not Stripe/Sentry/FullStory/Zendesk's native webhook integrations —
consistent with the existing platform stance that MCP is the generic
extension point (the "USB-C") and named integrations are reference
implementations, not something every new capability needs to be built
against individually.

**Files touched:** `models/scout.py` (new),
`alembic/versions/0020_scouts.py` (new), `services/scouts.py` (new),
`services/mcp_client.py`, `services/sources/scout.py` (new),
`services/sources/__init__.py`, `schemas/scout.py` (new),
`api/scouts.py` (new), `main.py`, `components/ScoutsConfig.tsx` (new),
`components/McpServerConfig.tsx`, README.

## Ground rules for future sessions

- When adding a new signal source or fix-agent integration, ask "does this
  need to be code, or can it be data a user enters?" Default to data.
- Don't chase feature parity with vertically-integrated competitors' proactive
  scanners (session replay analysis, SDK health checks) by building a
  first-party tracker of our own — that's the iOS move. Build the generic
  interface that lets *any* connected source play that role instead.
- Before assuming something is hard-locked to a vendor, check whether it
  already isn't — the OpenAI dependency turned out to be mostly a stale-docs
  problem (`ai_chat` already preferred LM Studio when configured), not a code
  problem. Read the code path, not just the README, before scoping a fix.
- All model access goes through `services/llm.py` now — don't construct an
  `AsyncOpenAI` client anywhere else, or the next BYO-model gap creeps back in.
- New pipeline stage transitions should call `emit_event` from
  `services/webhook_dispatch.py` (add a new `EVENT_*` constant if needed)
  rather than assuming third parties will poll for the new state.
- Don't build a stage-override mechanism speculatively. The scoring webhook
  exists because a concrete use case (custom scoring plugin) demanded it —
  wait for the next concrete ask before adding one to recommend/file-issue/
  trigger-fix.
- A "proactive" feature isn't just "poll more often" — the bar is that most
  runs produce nothing. If a new scheduled check would create noise on
  every tick, it's not a scout, it's a sync interval; don't blur the two.
- Before touching `services/evaluator.py`'s clustering/scoring logic, read
  whatever session/prompt produced the clustering evaluation this doc
  points to above — don't re-derive the analysis from scratch.
