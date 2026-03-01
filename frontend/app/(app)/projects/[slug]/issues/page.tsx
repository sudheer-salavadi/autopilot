import { apiServer } from "@/lib/api-server";
import ClustersFeed from "@/components/ClustersFeed";
import type { ClustersPage } from "@/lib/hooks/useClusters";
import { PageTitle } from "@/components/PageTitle";

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
      <PageTitle title="Issues" />
      <ClustersFeed slug={slug} initialData={initialData} initialCrossChannel={initialConfig.cross_channel} />
    </>
  );
}
