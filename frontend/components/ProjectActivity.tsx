"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/lib/api";

interface AuditEntry {
  id: string;
  actor_email: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  summary: string;
  created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  "cluster.issue_filed": "Issue filed",
  "cluster.fix_requested": "Fix triggered",
  "cluster.status_changed": "Status changed",
  "member.added": "Member added",
  "member.removed": "Member removed",
};

export default function ProjectActivity({ slug }: { slug: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient()
      .get<AuditEntry[]>(`/api/projects/${slug}/audit`)
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return <p className="text-sm text-muted-foreground animate-pulse">Loading activity…</p>;
  }

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No activity yet. Outward-facing actions — filing GitHub issues, triggering
        coding agents, resolving issues, membership changes — are recorded here
        with who did them.
      </p>
    );
  }

  return (
    <div className="rounded-xl ring-1 ring-foreground/10 divide-y overflow-hidden">
      {entries.map((e) => (
        <div key={e.id} className="flex items-start gap-3 px-4 py-3 bg-card">
          <Badge variant="outline" className="mt-0.5 shrink-0">
            {ACTION_LABELS[e.action] ?? e.action}
          </Badge>
          <div className="flex-1 min-w-0">
            <p className="text-sm">{e.summary}</p>
            <p className="text-xs text-muted-foreground">
              {e.actor_email === "autopilot" ? "Autopilot (automatic)" : e.actor_email}
              {" · "}
              {new Date(e.created_at).toLocaleString()}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
