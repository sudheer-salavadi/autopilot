"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient } from "@/lib/api";

export interface Project {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const api = apiClient();

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<Project[]>("/api/projects");
      setProjects(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const createProject = useCallback(
    async (name: string, slug: string) => {
      const project = await api.post<Project>("/api/projects", { name, slug });
      setProjects((prev) => [project, ...prev]);
      return project;
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return { projects, loading, error, refetch: fetchProjects, createProject };
}
