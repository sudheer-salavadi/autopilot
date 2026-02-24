import { apiServer } from "@/lib/api-server";
import IntegrationsPanel, {
  type Integration,
  type Project,
} from "@/components/IntegrationsPanel";

export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [project, integrations] = await Promise.all([
    apiServer<Project>(`/api/projects/${slug}`),
    apiServer<Integration[]>(`/api/projects/${slug}/integrations`),
  ]);

  return (
    <>
    <div className="-mx-6 -mt-6">
      <h1 className="text-2xl font-bold px-4 py-2 border-b">Integrations</h1>
      <IntegrationsPanel project={project} initialIntegrations={integrations} />
    </div>
    </>
  );
}
