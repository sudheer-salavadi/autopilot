<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Autopilot Next.js App Router project. Here is a summary of every change made:

- **`instrumentation-client.ts`** (new) — Client-side PostHog initialisation using the Next.js 15.3+ `instrumentation-client` pattern. Initialises `posthog-js` with a `/ingest` reverse proxy, `capture_exceptions: true` for automatic error tracking, and debug mode in development.
- **`lib/posthog-server.ts`** (new) — Server-side PostHog singleton using `posthog-node` v5, configured with `flushAt: 1` and `flushInterval: 0` for immediate event flushing in short-lived serverless functions.
- **`next.config.ts`** (updated) — Added `/ingest/static/:path*` and `/ingest/:path*` reverse proxy rewrites to route PostHog traffic through Next.js (reduces ad-blocker interception), and `skipTrailingSlashRedirect: true` as required by PostHog.
- **`.env.local`** (updated) — `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` written via wizard-tools (never hardcoded in source).
- **`package.json`** — `posthog-node` added as a dependency.
- Six component files updated with targeted `posthog.capture()` and `posthog.captureException()` calls (see table below).

## Instrumented events

| Event | Description | File |
|---|---|---|
| `project_created` | User successfully creates a new project | `app/(app)/projects/new/page.tsx` |
| `project_create_failed` | Project creation attempt failed (with error) | `app/(app)/projects/new/page.tsx` |
| `integration_enabled` | User enables or updates a webhook / MCP integration | `components/IntegrationConfig.tsx` |
| `integration_enable_failed` | Integration save attempt failed (with error) | `components/IntegrationConfig.tsx` |
| `integration_mcp_sync_triggered` | User manually triggers a Stripe MCP pull sync | `components/IntegrationConfig.tsx` |
| `integration_simulate_toggled` | User toggles simulate mode on/off for an integration | `components/IntegrationsPanel.tsx` |
| `github_app_installed` | GitHub App installation callback completed (detected via query param) | `components/GitHubConfig.tsx` |
| `github_repo_saved` | User saves a GitHub repository selection | `components/GitHubConfig.tsx` |
| `github_autopilot_toggled` | User enables/disables Autopilot mode (auto-file issues) | `components/GitHubConfig.tsx` |
| `github_connection_verified` | User tests the GitHub connection | `components/GitHubConfig.tsx` |
| `team_member_invited` | User invites a team member by email | `components/MembersList.tsx` |
| `team_member_removed` | User removes a team member from the project | `components/MembersList.tsx` |
| `ask_ai_query_sent` | User sends a message to the Ask AI panel | `components/AskAI.tsx` |
| `prioritization_config_saved` | User saves severity weight and normalization cap settings | `components/PrioritizationConfig.tsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- 📊 **Dashboard — Analytics basics**: https://us.posthog.com/project/169029/dashboard/1324373
- 🔀 **Activation funnel: Project → Integration → Ask AI**: https://us.posthog.com/project/169029/insights/XczmPYjd
- 📈 **Project creation trend** (created vs failed): https://us.posthog.com/project/169029/insights/tdR1rK5R
- 🔌 **Integration adoption by type**: https://us.posthog.com/project/169029/insights/SWMg8WME
- 🤖 **Daily Ask AI engagement** (DAU): https://us.posthog.com/project/169029/insights/PEuQJMs2
- 👥 **Team growth: invites vs removals**: https://us.posthog.com/project/169029/insights/vqpmU9pn

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/posthog-integration-nextjs-app-router/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
