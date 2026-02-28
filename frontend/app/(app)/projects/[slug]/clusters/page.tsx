import { apiServer } from "@/lib/api-server";
import ClustersFeed from "@/components/ClustersFeed";
import type { ClustersPage } from "@/lib/hooks/useClusters";

interface ScoringConfig {
  cross_channel: boolean;
}

export default async function ClustersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let initialData: ClustersPage | null = null;
  let initialConfig: ScoringConfig = { cross_channel: true };

  await Promise.allSettled([
    apiServer<ClustersPage>(`/api/projects/${slug}/clusters`).then((d) => { initialData = d; }),
    apiServer<ScoringConfig>(`/api/projects/${slug}/scoring-config`).then((c) => { initialConfig = c; }),
  ]);

  return (
    <>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Clusters</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Events grouped by root cause and ranked by priority score.
        </p>
      </div>

      <ClustersFeed slug={slug} initialData={initialData} initialCrossChannel={initialConfig.cross_channel} />
    </>
  );
}
