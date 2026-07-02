import { apiServer } from "@/lib/api-server";
import IntegrationsPanel, {
  type Integration,
  type Project,
} from "@/components/IntegrationsPanel";
import { type GithubConfig } from "@/components/GitHubConfig";
import { type AgentProvider } from "@/components/CodingAgentsConfig";
import { type WebhookSubscription } from "@/components/WebhooksConfig";
import { PageTitle } from "@/components/PageTitle";

interface ScoringConfig {
  simulate_stripe: boolean;
  simulate_sentry: boolean;
  simulate_fullstory: boolean;
  simulate_zendesk: boolean;
}

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [project, integrations, scoringConfig, githubConfig, agentProviders, webhookSubscriptions, webhookEventTypes] = await Promise.all([
    apiServer<Project>(`/api/projects/${slug}`),
    apiServer<Integration[]>(`/api/projects/${slug}/integrations`),
    apiServer<ScoringConfig>(`/api/projects/${slug}/scoring-config`).catch(() => null),
    apiServer<GithubConfig>(`/api/projects/${slug}/github-config`).catch(() => null),
    apiServer<AgentProvider[]>(`/api/projects/${slug}/agent-config`).catch(() => null),
    apiServer<WebhookSubscription[]>(`/api/projects/${slug}/webhook-subscriptions`).catch(() => null),
    apiServer<string[]>(`/api/projects/${slug}/webhook-subscriptions/event-types`).catch(() => null),
  ]);

  const initialSimulatingTypes = [
    scoringConfig?.simulate_stripe    && "stripe",
    scoringConfig?.simulate_sentry    && "sentry",
    scoringConfig?.simulate_fullstory && "fullstory",
    scoringConfig?.simulate_zendesk   && "zendesk",
  ].filter(Boolean) as string[];

  return (
    <>
      <PageTitle title="Integrations" />
      <div className="-mx-6 -mt-6 -mb-6">
        <IntegrationsPanel
          project={project}
          initialIntegrations={integrations}
          initialSimulatingTypes={initialSimulatingTypes}
          initialGithubConfig={githubConfig ?? undefined}
          initialAgentProviders={agentProviders ?? undefined}
          initialWebhookSubscriptions={webhookSubscriptions ?? undefined}
          initialWebhookEventTypes={webhookEventTypes ?? undefined}
          appSlug={process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? ""}
        />
      </div>
    </>
  );
}
