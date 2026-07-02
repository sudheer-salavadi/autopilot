# Platform vision — Autopilot as the "Android" of self-driving product management

Read this before starting any new session on the coding-agent / signal-source /
orchestration parts of Autopilot. It captures the strategic bet behind several
recent features and the roadmap that follows from it, so the reasoning doesn't
have to be re-derived from scratch every session.

## The comparison that motivates this

PostHog ships a competing "self-driving" loop: signals (from their own error
tracking, session replay, logs, health checks, plus a few external trackers)
group into reports, an agent investigates each report, opens a PR for the
actionable ones, and a post-merge check feeds the result back as a new signal.
Docs: https://posthog.com/docs/self-driving/{inbox,reports,signals,self-improving-loop}

That loop is **vertically integrated, iOS-style**: it's best-in-class if you
run PostHog's own tracker and PostHog's own agent, and closed if you don't.

Autopilot's bet is the opposite: be the **Android** of this space — don't own
the tracker or the agent, own the layer in between (ingest → cluster by root
cause → score by business impact → recommend → orchestrate a fix) and make
every layer above and below it swappable. Win by being the neutral hub that
plugs into whatever stack a team already has, not by forcing them onto ours.

## Strategic pillars — current state

| Pillar | What "Android-like" means here | Status |
|---|---|---|
| **Signal sources** | Any tool can feed events in, not just named integrations | Partial — Stripe/Sentry/FullStory/Zendesk webhooks + generic MCP polling (`services/mcp_client.py`). MCP is the real "USB-C" here; named integrations are reference implementations, not the ceiling. |
| **Fix agents** | Any coding agent can be triggered, not one owned agent | In progress — provider registry in `services/coding_agents.py` + `ProjectAgentConfig`. Started with 3 hardcoded vendors (Claude/Codex/Gemini); **current task is making this user-extensible** (custom provider entries), see below. |
| **LLM for the core pipeline** | BYO model for clustering/scoring/embeddings/Ask AI | Not started — OpenAI is a hard requirement (README: "required... there is no substitute"). Gemini is fallback-only. This is the most iOS-like lock-in left in Autopilot's own stack. |
| **Proactive scouts** | Generic scheduled-probe interface, not just reactive webhooks | Not started. PostHog's edge (session-replay scanning, SDK/health checks) comes from owning the tracker; Autopilot's answer shouldn't be building that — it should be a generic "scout" that runs a scheduled query against *any* connected MCP source and feeds findings into the same clustering pipeline. |
| **Open pipeline APIs** | Each stage (ingest/cluster/score/recommend/file/fix) independently addressable by third parties | Not started. Today it's one closed flow inside the FastAPI app. |
| **Self-hosting** | No forced cloud dependency | Done — Docker Compose, `SKIP_AUTH=true` for zero-config local runs. |

## Roadmap (priority order, as of 2026-07-02)

1. **User-extensible coding-agent providers** ← *current task, see plan below*
2. **BYO LLM for the core pipeline** — biggest remaining vertical lock-in. Likely shape: an LLM-provider abstraction (already have OpenAI + Gemini clients in `services/`) generalized to any OpenAI-compatible endpoint, with local-model support extended from Simulate-mode-only to the real evaluator.
3. **Generic scout interface** — scheduled queries against any MCP source, findings feed the existing `Cluster`/`Event` pipeline. Reuses the existing `background_mcp_puller` polling infra in `main.py`.
4. **Open pipeline APIs / stage-level extensibility** — biggest scope, lowest current priority. Revisit once 2 and 3 are done.

## Current task: user-extensible coding-agent providers

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
- Don't chase feature parity with PostHog's proactive scanners (session
  replay analysis, SDK health checks) by rebuilding their tracker — that's
  the iOS move. Build the generic interface that lets *any* connected source
  play that role instead.
- The OpenAI hard dependency is a known, tracked gap (#2 above), not an
  oversight — don't "fix" it as a drive-by change without scoping it
  properly (it touches clustering, scoring, embeddings, and Ask AI).
