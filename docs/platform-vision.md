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
| **Proactive scouts** | Generic scheduled-probe interface, not just reactive webhooks | Not started. Vertically-integrated competitors get proactive detection (session-replay scanning, SDK/health checks) by owning the tracker; Autopilot's answer shouldn't be building a first-party tracker — it should be a generic "scout" that runs a scheduled query against *any* connected MCP source and feeds findings into the same clustering pipeline. |
| **Open pipeline APIs** | Each stage (ingest/cluster/score/recommend/file/fix) independently addressable by third parties | Not started. Today it's one closed flow inside the FastAPI app. |
| **Self-hosting** | No forced cloud dependency | Done — Docker Compose, `SKIP_AUTH=true` for zero-config local runs. |

## Roadmap (priority order, as of 2026-07-02)

1. ~~User-extensible coding-agent providers~~ — done
2. ~~BYO LLM for the core pipeline~~ — done, see below
3. **Generic scout interface** ← next up. Scheduled queries against any MCP source, findings feed the existing `Cluster`/`Event` pipeline. Reuses the existing `background_mcp_puller` polling infra in `main.py`.
4. **Open pipeline APIs / stage-level extensibility** — biggest scope, lowest current priority. Revisit once 3 is done.

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
