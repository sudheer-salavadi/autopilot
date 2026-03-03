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

  const [initialData, githubConfig] = await Promise.all([
    apiServer<ClustersPage>(`/api/projects/${slug}/clusters`).catch(() => null),
    apiServer<{ repo: string | null; is_installed: boolean }>(
      `/api/projects/${slug}/github-config`
    ).catch(() => null),
  ]);

  const githubRepo =
    githubConfig?.is_installed && githubConfig.repo ? githubConfig.repo : null;

  return (
    <>
      <PageTitle title="Issues" />
      <ClustersFeed slug={slug} initialData={initialData} openId={openId} githubRepo={githubRepo} />
    </>
  );
}
