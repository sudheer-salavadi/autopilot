# Autopilot

Cross-tool observability for product and engineering teams. Autopilot ingests events from Stripe, Sentry, FullStory, and Zendesk, groups them by root cause across all sources, scores them by business impact, and surfaces what to fix first.

## The problem

Product and engineering teams operate across four tools — Stripe for revenue, Sentry for errors, FullStory for UX friction, Zendesk for support. Each fires separate alerts. There is no shared view, no root cause, and no ranking. The result: teams spend hours triaging noise and miss the issues that are actually costing them money or users.

## What it does

- **Ingests events via webhook** from Stripe, Sentry, FullStory, and Zendesk — or connects any **MCP-compatible server** to pull events on a schedule (no public webhook URL required)
- **Clusters events by root cause**, not by source — a Stripe payment failure, a Sentry exception, and a FullStory rage-click from the same checkout flow become one issue, not three alerts
- **Scores every issue by business impact** — revenue at risk, frequency, and UX friction signals, weighted however you choose
- **Explains root cause and recommends a fix** — see affected users, cross-source signal breakdown, and a suggested next step
- **Files GitHub issues** — connect a repo and send any issue to your tracker, pre-written with full context
- **Ask AI** — chat with the data to answer questions like "what's causing the most churn?" or "which users are affected by the checkout bug?"

## Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI, SQLAlchemy 2.0, Alembic, PostgreSQL + pgvector |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS v4 |
| Auth | WorkOS |
| AI | OpenAI API — or LM Studio (local) with Gemini as fallback |
| Deployment | Docker Compose |

## Self-hosting

### Prerequisites

- Docker and Docker Compose
- A [WorkOS](https://workos.com) account (free tier works — used for auth)
- An OpenAI API key **or** a local [LM Studio](https://lmstudio.ai) instance — required for Simulate mode and issue clustering/scoring. Without one, simulation generates no events and the evaluator won't run. Gemini can be set as a fallback via `GEMINI_API_KEY`.

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Where to get it |
|---|---|
| `WORKOS_API_KEY` | WorkOS dashboard → API Keys |
| `WORKOS_CLIENT_ID` | WorkOS dashboard → Applications |
| `WORKOS_COOKIE_PASSWORD` | Generate: `openssl rand -hex 32` |
| `SESSION_SECRET_KEY` | Generate: `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | Generate: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) |

WorkOS setup:
1. Create an application in the WorkOS dashboard
2. Set the redirect URI to `http://localhost:8000/api/auth/callback`
3. Enable the "AuthKit" sign-in method

### 2. Start services

```bash
docker compose up
```

### 3. Run migrations (first run only)

```bash
docker compose exec backend alembic upgrade head
```

### 4. Open the app

Visit `http://localhost:3000`

## Using LM Studio instead of OpenAI

Set these in `.env` (takes priority over `OPENAI_API_KEY` when set):

```env
LM_STUDIO_URL=http://host.docker.internal:1234/v1
LM_STUDIO_MODEL=your-model-name
```

A Gemini fallback is also available:

```env
GEMINI_API_KEY=AIza...
GEMINI_MODEL=gemini-2.0-flash   # optional, this is the default
```

## MCP Server integration (optional)

Connect any MCP-compatible server (Stripe Agent Toolkit, Datadog, custom internal tools) and Autopilot will pull events from it on a schedule — no public webhook URL required, works fully locally.

In the app: **Integrations → MCP Server**

1. Enter the server URL (Streamable HTTP transport — hosted MCP servers work directly; local servers must be reachable from the Docker network via `host.docker.internal` or a shared network)
2. Set authentication (None, Bearer token, or custom header)
3. Click **Discover tools** to fetch the available tool list
4. Select which tools to poll and set the sync interval (5 min / 15 min / 1 hour)
5. Save — Autopilot pulls on schedule and deduplicates results automatically

## GitHub integration (optional)

Autopilot can file GitHub issues automatically when a problem cluster exceeds your priority threshold.

1. [Register a GitHub App](https://github.com/settings/apps/new)
   - Callback URL: `{FRONTEND_URL}/github/callback`
   - Webhook URL: `{BACKEND_URL}/api/webhooks/github-app`
   - Permissions: Issues → Read & Write, Metadata → Read
   - Events: Issues, Installation
2. Add to `.env`:
   ```env
   GITHUB_APP_ID=your_app_id
   GITHUB_APP_SLUG=your-app-slug
   GITHUB_APP_PRIVATE_KEY=   # PEM contents, newlines as \n
   GITHUB_APP_WEBHOOK_SECRET=your_webhook_secret
   NEXT_PUBLIC_GITHUB_APP_SLUG=your-app-slug
   ```
3. In the app: Settings → GitHub → Install GitHub App → select a repo

To test webhooks locally, use a tunnel:
```bash
cloudflared tunnel --url http://localhost:8000
```

## Evaluating the product before connecting real integrations

Autopilot includes a **Simulate** mode so you can walk through the full product experience — clustering, scoring, root cause analysis, GitHub filing, Ask AI — without configuring a single webhook. It's an onboarding shortcut, not a production feature: once your real integrations are sending events, turn Simulate off.

1. Create a project
2. Go to **Integrations** → toggle **Simulate** on any source — AI-generated events start flowing immediately
3. Go to **Issues** to see clustering and scoring in action
4. Open any issue to see root cause, affected users, revenue impact, and recommended fix
5. Adjust scoring weights in **Settings → Prioritization**
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
