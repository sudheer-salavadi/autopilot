import { apiServer } from "@/lib/api-server";
import PrioritizationConfig from "@/components/PrioritizationConfig";

interface ScoringConfig {
  project_id: string;
  weight_revenue: number;
  weight_frequency: number;
  weight_ux: number;
  max_revenue_usd: number;
  max_frequency_count: number;
}

const DEFAULT_CONFIG: Omit<ScoringConfig, "project_id"> = {
  weight_revenue: 0.5,
  weight_frequency: 0.3,
  weight_ux: 0.2,
  max_revenue_usd: 10000,
  max_frequency_count: 100,
};

export default async function PrioritizationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let config: ScoringConfig | null = null;
  try {
    config = await apiServer<ScoringConfig>(`/api/projects/${slug}/scoring-config`);
  } catch {
    // fall back to defaults so the form still renders
  }

  const initialConfig: ScoringConfig = config ?? {
    project_id: "",
    ...DEFAULT_CONFIG,
  };

  return <PrioritizationConfig slug={slug} initialConfig={initialConfig} />;
}
