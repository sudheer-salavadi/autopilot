import { apiServer } from "@/lib/api-server";
import IntegrationsPanel, {
  type Integration,
  type Project,
} from "@/components/IntegrationsPanel";

interface ScoringConfig {
  simulate_stripe: boolean;
  simulate_sentry: boolean;
  simulate_fullstory: boolean;
}

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [project, integrations, scoringConfig] = await Promise.all([
    apiServer<Project>(`/api/projects/${slug}`),
    apiServer<Integration[]>(`/api/projects/${slug}/integrations`),
    apiServer<ScoringConfig>(`/api/projects/${slug}/scoring-config`).catch(() => null),
  ]);

  const initialSimulatingTypes = [
    scoringConfig?.simulate_stripe    && "stripe",
    scoringConfig?.simulate_sentry    && "sentry",
    scoringConfig?.simulate_fullstory && "fullstory",
  ].filter(Boolean) as string[];

  return (
    <>
    <div className="-mx-6 -mt-6">
      <h1 className="text-2xl font-bold px-4 py-2 border-b">Integrations</h1>
      <IntegrationsPanel
        project={project}
        initialIntegrations={integrations}
        initialSimulatingTypes={initialSimulatingTypes}
      />
    </div>
    </>
  );
}
