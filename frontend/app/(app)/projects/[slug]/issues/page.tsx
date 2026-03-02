import { apiServer } from "@/lib/api-server";
import ClustersFeed from "@/components/ClustersFeed";
import type { ClustersPage } from "@/lib/hooks/useClusters";
import { PageTitle } from "@/components/PageTitle";

export default async function ClustersPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ open?: string }>;
}) {
  const { slug } = await params;
  const { open: openId } = await searchParams;

  const initialData = await apiServer<ClustersPage>(
    `/api/projects/${slug}/clusters`
  ).catch(() => null);

  return (
    <>
      <PageTitle title="Issues" />
      <ClustersFeed slug={slug} initialData={initialData} openId={openId} />
    </>
  );
}
