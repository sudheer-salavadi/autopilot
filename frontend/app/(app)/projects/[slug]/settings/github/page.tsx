import { apiServer } from "@/lib/api-server";
import GitHubConfig from "@/components/GitHubConfig";

interface GithubConfig {
  project_id: string;
  repo: string | null;
  has_token: boolean;
  autopilot_enabled: boolean;
  autopilot_min_score: number;
}

const DEFAULT_CONFIG: Omit<GithubConfig, "project_id"> = {
  repo: null,
  has_token: false,
  autopilot_enabled: false,
  autopilot_min_score: 0.7,
};

export default async function GitHubSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let config: GithubConfig | null = null;
  try {
    config = await apiServer<GithubConfig>(`/api/projects/${slug}/github-config`);
  } catch {
    // render with defaults so the form still shows
  }

  const initialConfig: GithubConfig = config ?? {
    project_id: "",
    ...DEFAULT_CONFIG,
  };

  return <GitHubConfig slug={slug} initialConfig={initialConfig} />;
}
