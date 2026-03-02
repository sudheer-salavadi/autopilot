"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api";

export interface ClusterEvent {
  id: string;
  source: string;
  event_type: string;
  received_at: string;
  payload: Record<string, unknown>;
}

export interface Cluster {
  id: string;
  project_id: string;
  title: string;
  root_cause: string;
  revenue_score: number;
  frequency_score: number;
  ux_score: number;
  priority_score: number;
  event_count: number;
  affected_users: number;
  first_seen: string;
  last_seen: string;
  status: "open" | "investigating" | "resolved";
  created_at: string;
  updated_at: string;
  pm_insight: string | null;
  parent_cluster_id: string | null;
  regression_count: number;
  github_issue_number: number | null;
  github_issue_url: string | null;
  event_ids: string[];
  event_payloads?: ClusterEvent[];
}

export interface ClustersPage {
  items: Cluster[];
  total: number;
  page: number;
  page_size: number;
}

export interface ClustersParams {
  view?: "active" | "resolved";
  source?: string;       // "stripe" | "sentry" | "fullstory" | ""
}

function buildQs(params: ClustersParams): string {
  const q = new URLSearchParams();
  q.set("page_size", "100");
  if (params.view && params.view !== "active") q.set("view", params.view);
  if (params.source) q.set("source", params.source);
  return `?${q.toString()}`;
}

export function useClusters(
  slug: string,
  initialData?: ClustersPage | null,
  params: ClustersParams = {},
) {
  const qs = buildQs(params);

  const [data, setData] = useState<ClustersPage | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  const api = apiClient();

  const fetchClusters = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<ClustersPage>(`/api/projects/${slug}/clusters${qs}`);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load clusters");
    } finally {
      setLoading(false);
    }
  }, [slug, qs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Skip the very first effect invocation when SSR initialData covers the
  // default view (qs = ""). Any subsequent change to fetchClusters (slug or
  // params change) triggers a fresh fetch.
  const skipInitial = useRef(!!initialData && qs === "");
  useEffect(() => {
    if (skipInitial.current) {
      skipInitial.current = false;
      return;
    }
    fetchClusters();
  }, [fetchClusters]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, refetch: fetchClusters };
}
