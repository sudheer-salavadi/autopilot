# Autopilot

**The open-source, self-hosted triage layer between your monitoring stack and your coding agents.** Autopilot correlates a Stripe payment failure, the Sentry exception behind it, the FullStory rage-clicks it caused, and the Zendesk tickets it generated into **one root-cause issue**, prices it by **revenue at risk**, files it to GitHub with the evidence attached — and hands it to Claude Code, Codex, Gemini, or any coding agent you run to fix.

![Autopilot screenshot](frontend/public/screenshot.png)

## The problem

If you're an engineer, product engineer, or a technical founder wearing every hat, your signals live in four vendors: Stripe for revenue, Sentry for errors, FullStory for UX friction, Zendesk for support. Each one alerts correctly. None of them see each other. A failed $12k renewal is a Stripe email, the exception that caused it is a Sentry alert, the users rage-clicking "Renew" are a FullStory dashboard, and the angry ticket lands in Zendesk — four alerts, one bug, and the job of connecting them (and deciding whether it beats everything else in the queue) happens in your head, every time.

Autopilot automates exactly that triage step: cluster cross-tool signals by root cause, score by business impact in dollars, hand off the fix. It doesn't own your tracker and it doesn't own your agent — it owns the judgment layer in between, and every layer above and below it is swappable.

## The loop

1. **Ingest** — webhooks from Stripe, Sentry, FullStory, and Zendesk, or pull from any **MCP-compatible server** on a schedule (no public webhook URL required)
2. **Scout** — proactive scheduled checks against any MCP source that only create an issue when an LLM judges the result a genuine finding against an objective you write; most runs produce nothing, by design
3. **Cluster** — events group by **root cause across tools** (pgvector similarity + LLM tiebreaker), not by source: one checkout bug is one issue, not four alerts
4. **Score** — every cluster is ranked by revenue at risk, recency-weighted frequency, and worst observed UX severity, with weights you control — or replace the whole formula with your own scoring webhook
5. **Recommend** — root cause, affected users, and cross-source signal breakdown synthesized into a concrete next step
6. **File** — GitHub issues created automatically above your priority threshold, pre-written with full context
7. **Fix** — trigger Claude Code, OpenAI Codex, Gemini Code Assist, **or any custom agent** on the filed issue; the resulting PR is linked back automatically
8. **Ask** — chat with the data: "what's causing the most churn?", "which users hit the checkout bug?"

Every stage transition emits a signed outbound webhook (`cluster.created`, `cluster.scored`, `cluster.issue_filed`, `cluster.fix_pr_linked`, ...), so anything downstream — Slack bots, dashboards, your own automation — can react without polling.

## How it compares — PostHog Inbox, Sentry Seer, and DIY

Autopilot runs the same signals → root cause → priority → agent-PR loop as the vertically integrated tools, with the opposite architectural bet: **bring your own everything**.

| | **Autopilot** | **PostHog Inbox** | **Sentry Seer** |
|---|---|---|---|
| Signal sources | Any — Stripe/Sentry/FullStory/Zendesk webhooks, any MCP server, scheduled scouts | PostHog's own product suite (error tracking, session replay, experiments, surveys, support) | Errors and traces captured by Sentry |
| Grouping | Cross-vendor root-cause clustering (embeddings + LLM) | Signals grouped into weighted reports | Per-error issue grouping |
| Prioritization | Revenue at risk in $, recency-decayed frequency, worst UX severity — weights configurable, formula replaceable via webhook | Report weight crosses a promotion threshold | Error-level severity/volume |
| Fix agent | Any — Claude Code, Codex, Gemini, or a custom trigger phrase | PostHog Code | Seer autofix (or handoff) |
| LLM | Bring your own: any OpenAI-compatible endpoint, incl. fully local (Ollama, LM Studio, vLLM) | Theirs | Theirs |
| Hosting | Self-hosted, Docker Compose, MIT license | PostHog Cloud (self-driving features in beta) | Sentry's cloud |

To be fair to both: if your whole stack already runs on PostHog's SDKs, their Inbox is deeply integrated with data Autopilot never sees, and if a problem is purely a code error, Seer reads stack traces and traces inside Sentry at a depth a webhook consumer can't. Pick Autopilot when your signals are spread across more than one vendor, you want prioritization denominated in dollars rather than event counts, or self-hosting and model choice are non-negotiable.

*Autopilot is not affiliated with or endorsed by PostHog or Sentry (Functional Software, Inc.); product names are used only to identify them. Comparison reflects public docs as of July 2026 — corrections welcome via PR.*

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI, SQLAlchemy 2.0, Alembic, PostgreSQL + pgvector |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS v4 |
| Auth | Built in — email + password (bcrypt) with JWT session cookies, no external identity provider |
| AI | Bring your own model (any OpenAI-compatible endpoint) — OpenAI is the zero-config default, Gemini an optional failure fallback |
| Deployment | Docker Compose |

## Self-hosting

### Prerequisites

- Docker and Docker Compose
- A model for clustering, scoring, embeddings, and Ask AI — **any** OpenAI-compatible endpoint works (LM Studio, Ollama, vLLM, OpenRouter, ...), or an OpenAI API key as the zero-config default. See **AI model configuration** below.

That's the whole list. Auth is built in (email + password) — there is no identity provider to sign up for and no OAuth app to register.

### Quickest start — skip auth entirely

Set `SKIP_AUTH=true` in your `.env` to bypass authentication completely while evaluating. A "Dev User" is created automatically on first request — no accounts, no session keys to generate.

```bash
cp .env.example .env
# Uncomment SKIP_AUTH=true in .env
# Add an OPENAI_API_KEY, or point AI_BASE_URL at a local model (see below) — either works
docker compose up
docker compose exec backend alembic upgrade head
# Visit http://localhost:3000
```

> **Never use `SKIP_AUTH=true` in production.** All requests run as the same shared user with no access control.

### Full setup with accounts

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Where to get it |
|---|---|
| `SESSION_SECRET_KEY` | Generate: `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | Generate: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) |

### 2. Start services and run migrations (first run only)

```bash
docker compose up
docker compose exec backend alembic upgrade head
```

### 3. Create your account

Visit `http://localhost:3000`, click **Get started**, and create the first account — email and password, stored in your own database (bcrypt-hashed). **The first account automatically becomes the instance admin.**

### Roles & access

Two independent levels:

- **Instance roles** (`admin` / `member`): admins get **Settings → Team & access** to list users, create accounts directly (with a starting password), change roles, reset passwords, and delete users. Guardrails: the last admin can't be demoted or deleted, and a user who owns projects can't be deleted until those projects are.
- **Project roles** (`owner` / `member`): unchanged — every project is invisible to non-members, owners manage membership and settings under **Settings → Team**. Being an instance admin does *not* grant access to project data; admins manage accounts, not your signals.

Typical flow: teammates sign up themselves (or an admin creates their accounts), then a project owner invites them by email. Once everyone's in, lock registration with `DISABLE_SIGNUP=true` — existing accounts keep working, and the first-account bootstrap still works on a fresh install so you can't lock yourself out.

Password resets are admin-driven (**Settings → Team & access → key icon**) — deliberately no email-based reset flow, so there's no SMTP dependency. Users change their own password under **Settings → Account**.

**Audit trail instead of granular permissions:** any project member can file issues and trigger coding agents, and every outward-facing action — GitHub issue filed (manually or by Autopilot), coding agent triggered, status changed, member added/removed — is recorded with who did it under **Settings → Activity**. Instance-admin actions (user created/deleted, role changed, password reset) appear under **Settings → Team & access**.

**Login protection:** failed logins are rate-limited per account (10 per 15 minutes, cleared on success) and per IP, and signups per IP — brute-forcing a password returns `429` long before it becomes viable. Limits are in-memory per backend process, which is exact for the default single-process Docker deployment.

> **Upgrading from a WorkOS-based install?** Existing users keep their projects but have no password yet — the earliest-created account is backfilled as admin; set its password once via SQL (`docker compose exec backend python -c "import bcrypt; print(bcrypt.hashpw(b'newpassword', bcrypt.gensalt()).decode())"` then `UPDATE users SET password_hash='<hash>' WHERE email='<email>';`), then reset everyone else's from the admin panel.

## AI model configuration

Autopilot is bring-your-own-model. `AI_BASE_URL` points at **any OpenAI-compatible endpoint** — LM Studio, Ollama, vLLM, OpenRouter, a hosted inference provider, whatever you already run — and is used for clustering, scoring, root-cause synthesis, and Ask AI. This is the same code path as production, not a Simulate-only shortcut, so you can run the entire pipeline on infrastructure you control.

```env
# Ollama example — pull a model first: ollama pull llama3.1
AI_BASE_URL=http://host.docker.internal:11434/v1
AI_MODEL=llama3.1

# LM Studio example
# AI_BASE_URL=http://host.docker.internal:1234/v1
# AI_MODEL=your-model-name-from-lm-studio

# AI_API_KEY is optional — most local servers ignore it, some hosted
# OpenAI-compatible providers (e.g. OpenRouter) require a real key
# AI_API_KEY=
```

If `AI_BASE_URL` is unset, Autopilot falls back to `OPENAI_API_KEY` — this is the zero-config default so the app works out of the box, not a hard requirement:

```env
OPENAI_API_KEY=sk-...
```

A Gemini key can additionally be set as a **failure fallback** — used only when the primary call (local model or OpenAI) errors out, e.g. rate limits or an outage. It is never the primary path:

```env
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-2.0-flash   # optional, this is the default
```

### Embeddings

Clustering uses vector embeddings for similarity search (pgvector). By default this calls OpenAI's `text-embedding-3-small` (1536 dimensions) if `OPENAI_API_KEY` is set, or the same `AI_BASE_URL` endpoint if one is configured and it serves an embeddings model. To use a different embedding model:

```env
AI_EMBEDDING_MODEL=nomic-embed-text   # or whatever your endpoint serves
AI_EMBEDDING_DIMS=768                 # must match that model's output dimension
```

`AI_EMBEDDING_DIMS` sizes the database's vector column (`alembic/versions/0018_configurable_embedding_dims.py` reads it at migration time), so set it **before** running `alembic upgrade head` on a fresh database. If you change it after the fact on an existing database, you'll need a follow-up migration or manual `ALTER TABLE ... ALTER COLUMN embedding TYPE vector(N)` — changing embedding dimension always invalidates previously-stored embeddings, since they're no longer comparable to new ones. Without any embedding model configured, clustering still works — it falls through to the LLM-only clustering path, just with more model calls.

## MCP Server integration (optional)

Connect any MCP-compatible server (Stripe Agent Toolkit, Datadog, custom internal tools) and Autopilot will pull events from it on a schedule — no public webhook URL required, works fully locally.

In the app: **Integrations → MCP Server**

1. Enter the server URL (Streamable HTTP transport — hosted MCP servers work directly; local servers must be reachable from the Docker network via `host.docker.internal` or a shared network)
2. Set authentication (None, Bearer token, or custom header)
3. Click **Discover tools** to fetch the available tool list
4. Select which tools to poll and set the sync interval (5 min / 15 min / 1 hour)
5. Save — Autopilot pulls on schedule and deduplicates results automatically

### Scouts — proactive checks (optional)

Regular sync above mirrors every selected tool's result into an event, unconditionally, on a shared schedule. A **scout** is different: it calls one tool with fixed arguments on its own schedule, and only creates an issue when an LLM decides the result is a genuine finding against an objective you write — most runs should produce nothing. This is proactive detection layered on top of a connected MCP server, not a replacement for plain sync.

In the app: **Integrations → MCP Server**, once a server is connected, under **Scouts**:

1. Click **Add scout**
2. Name it, pick (or type) the tool to call, and optionally set fixed arguments as JSON
3. Write an objective in plain language — e.g. *"Flag it if the error rate is meaningfully above normal for this time of day"*
4. Set a check interval (5 min / 15 min / 1 hour)
5. Use **Run now** any time to test it immediately and see whether it found something

Every scout run is evaluated against its objective by the same AI model configured above (**AI model configuration**) — no cloud dependency beyond whatever you already configured there. A scout that finds something creates a normal event (`source: scout`) that flows through the same clustering, scoring, and prioritization pipeline as everything else; a scout that finds nothing does nothing, so scouts don't add noise even running every 5 minutes.

## GitHub integration (optional)

Autopilot can file GitHub issues automatically when a problem cluster exceeds your priority threshold.

1. [Register a GitHub App](https://github.com/settings/apps/new)
   - Callback URL: `{FRONTEND_URL}/github/callback`
   - Webhook URL: `{BACKEND_URL}/api/webhooks/github-app`
   - Permissions: Issues → Read & Write, Pull requests → Read-only, Metadata → Read
   - Events: Issues, Pull request, Installation
2. Add to `.env`:
   ```env
   GITHUB_APP_ID=your_app_id
   GITHUB_APP_SLUG=your-app-slug
   GITHUB_APP_PRIVATE_KEY=   # PEM contents, newlines as \n
   GITHUB_APP_WEBHOOK_SECRET=your_webhook_secret
   NEXT_PUBLIC_GITHUB_APP_SLUG=your-app-slug
   ```
3. In the app: go to **Integrations → GitHub** → Install GitHub App → select a repo

> If you registered the GitHub App before the **Pull requests** permission/event existed, update the App's permissions on GitHub and accept the new grant on each installation — otherwise PR-linking (see below) won't fire.

To test webhooks locally, use a tunnel:
```bash
cloudflared tunnel --url http://localhost:8000
```

## Fix with a coding agent (optional)

Once a GitHub issue is filed for a cluster, Autopilot can trigger a fix from Claude Code, OpenAI Codex, or Gemini Code Assist directly from the issue's detail panel — closing the loop from *identified* to *fixed* without leaving the app.

This doesn't run any agent itself. Each provider is its own GitHub App/Action that you install separately on your repo and that watches for a trigger comment (e.g. `@claude`) on an issue; Autopilot just posts that comment and links back the PR the agent opens.

1. In the app: go to **Integrations → Coding Agents**
2. Toggle on the providers you have installed on your repo (Claude Code, OpenAI Codex, Gemini Code Assist) — see each provider's own setup guide linked in that panel
3. Optionally customize the trigger comment per provider — the defaults follow each vendor's documented convention, but exact syntax can vary by how a repo has it configured
4. On any cluster with a filed GitHub issue, click **Fix with…** and pick a provider

Not using Claude/Codex/Gemini? Click **Add custom agent** in the same panel — any coding agent that watches GitHub issue comments and opens a PR works, since Autopilot only needs its name and trigger phrase. No code change or update required to support a new vendor.

Autopilot doesn't verify the provider is actually installed on your repo — if nothing happens after triggering, double-check the provider's GitHub App/Action is set up and that its trigger phrase matches what Autopilot posted. Once the agent opens a PR that references the issue (e.g. `Fixes #123`), Autopilot links it back to the cluster and shows its state (open / merged / closed).

## Webhooks (optional)

Every pipeline stage — ingest, cluster, score, recommend, file issue, trigger fix — is independently addressable instead of being one closed flow. Outbound webhooks let a third party (a Slack notifier, a custom dashboard, an internal alerting tool) react to a stage transition without polling the REST API; a custom scoring plugin (below) lets a third party replace the scoring stage's logic entirely.

### Outbound events

1. In the app: go to **Integrations → Webhooks** → **Add webhook**
2. Enter a URL and pick which events you want:
   - `cluster.created` — a new cluster was formed
   - `cluster.scored` — a cluster's priority score was (re)computed
   - `cluster.issue_filed` — a GitHub issue was filed for a cluster (manual or Autopilot auto-file)
   - `cluster.fix_requested` — a "Fix with…" trigger comment was posted
   - `cluster.fix_pr_linked` — a fix PR was detected and linked back (open, merged, or closed)
   - `cluster.resolved` — a cluster's status changed to resolved
3. Copy the signing secret shown once at creation — you'll need it to verify deliveries

Each delivery is a `POST` with the raw event as the body and two headers: `X-Autopilot-Event: <event type>` and `X-Autopilot-Signature: sha256=<hex>`, an HMAC-SHA256 of the body using your subscription's secret. Verify it before trusting the payload:

```python
import hashlib, hmac

def verify(secret: str, body: bytes, signature_header: str) -> bool:
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

Delivery is fire-and-forget and best-effort — a slow or dead endpoint never blocks or fails the pipeline stage that triggered it, and there's no retry queue. Use the **Send test event** button on a subscription to check it's reachable, and watch the "last delivery" status shown on each subscription for ongoing health.

### Custom scoring plugin

By default, priority score is `revenue_score × weight_revenue + frequency_score × weight_frequency + ux_score × weight_ux`, computed internally (**Settings → Prioritization**). To replace that with your own logic — e.g. factoring in ARR or account-tier data Autopilot doesn't have — set a scoring webhook URL in the same settings page. Autopilot POSTs the cluster's raw signal data (HMAC-signed, same scheme as above) and uses whatever your endpoint returns:

```json
{"revenue_score": 0.8, "frequency_score": 0.4, "ux_score": 0.2}
```

Autopilot still applies the project's configured weights to combine these three. To bypass the weights entirely, return `priority_score` directly instead:

```json
{"priority_score": 0.65}
```

On any failure — timeout, unreachable, malformed response — Autopilot falls back to the internal formula. A broken scoring plugin degrades gracefully; it never breaks clustering.

## Evaluating the product before connecting real integrations

Autopilot includes a **Simulate** mode so you can walk through the full product experience — clustering, scoring, root cause analysis, GitHub filing, Ask AI — without configuring a single webhook. It's an onboarding shortcut, not a production feature: once your real integrations are sending events, turn Simulate off.

1. Create a project
2. Go to **Integrations** → toggle **Simulate** on any source — AI-generated events start flowing immediately
3. Go to **Issues** to see clustering and scoring in action
4. Open any issue to see root cause, affected users, revenue impact, and recommended fix
5. Adjust scoring weights in **Settings → Severity**
6. When ready: configure a real integration and disable Simulate

## Project structure

```
autopilot/
├── backend/
│   ├── app/
│   │   ├── api/          # FastAPI route handlers
│   │   ├── models/       # SQLAlchemy models
│   │   ├── schemas/      # Pydantic schemas
│   │   └── services/     # AI, auth, webhooks, evaluation
│   ├── alembic/          # Database migrations
│   └── requirements.txt
└── frontend/
    ├── app/              # Next.js App Router pages
    ├── components/       # UI components
    └── lib/              # API client, hooks
```

## License

MIT
