"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient } from "@/lib/api";

export interface Event {
  id: string;
  project_id: string;
  integration_id: string | null;
  source: string;
  event_type: string;
  payload: Record<string, unknown>;
  received_at: string;
}

export interface EventsPage {
  items: Event[];
  total: number;
  page: number;
  page_size: number;
}

export function useEvents(slug: string, source?: string, event_type?: string) {
  const [data, setData] = useState<EventsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const api = apiClient();

  const fetchEvents = useCallback(
    async (p = page) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: String(p) });
        if (source) params.set("source", source);
        if (event_type) params.set("event_type", event_type);
        const result = await api.get<EventsPage>(
          `/api/projects/${slug}/events?${params}`
        );
        setData(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load events");
      } finally {
        setLoading(false);
      }
    },
    [slug, source, event_type, page] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    fetchEvents(page);
  }, [fetchEvents, page]);

  return { data, loading, error, page, setPage, refetch: () => fetchEvents(page) };
}
