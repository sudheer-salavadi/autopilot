"use client";

import { useCallback, useEffect, useState } from "react";
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
  event_ids: string[];
  event_payloads?: ClusterEvent[];
}

export interface ClustersPage {
  items: Cluster[];
  total: number;
  page: number;
  page_size: number;
}

export function useClusters(slug: string, initialData?: ClustersPage | null) {
  const [data, setData] = useState<ClustersPage | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  const api = apiClient();

  const fetchClusters = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<ClustersPage>(`/api/projects/${slug}/clusters`);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load clusters");
    } finally {
      setLoading(false);
    }
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!initialData) {
      fetchClusters();
    }
  }, [fetchClusters, initialData]);

  return { data, loading, error, refetch: fetchClusters };
}
