import { apiServer } from "@/lib/api-server";
import ProjectDashboard, { type DashboardData } from "@/components/ProjectDashboard";

interface Project {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [project, dashboard] = await Promise.all([
    apiServer<Project>(`/api/projects/${slug}`),
    apiServer<DashboardData>(`/api/projects/${slug}/dashboard`).catch(() => null),
  ]);

  const emptyDashboard: DashboardData = {
    cluster_stats: { active: 0, critical: 0, investigating: 0, resolved_30d: 0 },
    affected_users: 0,
    revenue_at_risk_usd: 0,
    top_clusters: [],
    events_24h: [],
    total_events: 0,
  };

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{project.name}</h1>
        <p className="text-sm text-muted-foreground font-mono mt-1">{project.slug}</p>
      </div>

      <ProjectDashboard slug={slug} data={dashboard ?? emptyDashboard} />
    </>
  );
}
