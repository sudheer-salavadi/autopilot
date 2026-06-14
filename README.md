# Autopilot

Cross-tool observability for product and engineering teams. Autopilot ingests events from Stripe, Sentry, FullStory, and Zendesk, groups them by root cause across all sources, scores them by business impact, and surfaces what to fix first.

## The problem

Product and engineering teams operate across four tools — Stripe for revenue, Sentry for errors, FullStory for UX friction, Zendesk for support. Each fires separate alerts. There is no shared view, no root cause, and no ranking. The result: teams spend hours triaging noise and miss the issues that are actually costing them money or users.

## What it does

- **Ingests events via webhook** from Stripe, Sentry, FullStory, and Zendesk — or generates realistic demo events via Simulate mode (no real data needed to get started)
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
- An OpenAI API key — or a local [LM Studio](https://lmstudio.ai) instance

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

A Gemini fallback is also available via `GEMINI_API_KEY` if the primary model fails.

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

## Getting started (no real data needed)

1. Create a project
2. Go to **Integrations** → enable **Simulate** on any source — Autopilot generates realistic demo events immediately using AI
3. Go to **Issues** — events are clustered and scored automatically
4. Open any issue to see root cause, affected users, revenue impact, and recommended fix
5. Adjust scoring weights in **Settings → Prioritization**

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
