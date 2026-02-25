import { apiServer } from "@/lib/api-server";
import { Separator } from "@/components/ui/separator";
import ClustersFeed from "@/components/ClustersFeed";
import type { ClustersPage } from "@/lib/hooks/useClusters";

export default async function ClustersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let initialData: ClustersPage | null = null;
  try {
    initialData = await apiServer<ClustersPage>(`/api/projects/${slug}/clusters`);
  } catch {
    // render client-side if SSR fails
  }

  return (
    <>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Clusters</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Events grouped by root cause and ranked by priority score.
        </p>
      </div>


      <ClustersFeed slug={slug} initialData={initialData} />
    </>
  );
}
