"use client";

import Link from "next/link";
import {
  IconAlertTriangle,
  IconBrandGithub,
  IconBug,
  IconChartBar,
  IconCircleCheck,
  IconCurrencyDollar,
  IconUsers,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";

// ── Types ──────────────────────────────────────────────────────────────────
interface TopCluster {
  id: string;
  title: string;
  root_cause: string;
  priority_score: number;
  event_count: number;
  affected_users: number;
  status: string;
  github_issue_number: number | null;
  last_seen: string;
}

interface SourceStat {
  source: string;
  count: number;
}

interface ClusterStats {
  active: number;
  critical: number;
  investigating: number;
  resolved_30d: number;
}

export interface DashboardData {
  cluster_stats: ClusterStats;
  affected_users: number;
  revenue_at_risk_usd: number;
  top_clusters: TopCluster[];
  events_24h: SourceStat[];
  total_events: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function scoreColor(score: number) {
  if (score >= 0.7) return "text-red-500";
  if (score >= 0.4) return "text-amber-500";
  return "text-emerald-500";
}

function scoreBg(score: number) {
  if (score >= 0.7) return "bg-red-500/10 text-red-500";
  if (score >= 0.4) return "bg-amber-500/10 text-amber-500";
  return "bg-emerald-500/10 text-emerald-500";
}

function fmtScore(n: number) {
  return (n * 10).toFixed(1);
}

function fmtUsd(n: number) {
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const SOURCE_LABEL: Record<string, string> = {
  stripe: "Stripe",
  sentry: "Sentry",
  fullstory: "FullStory",
};

// ── Sub-components ─────────────────────────────────────────────────────────
function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`text-muted-foreground/60 ${accent ?? ""}`}>{icon}</span>
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function ProjectDashboard({
  slug,
  data,
}: {
  slug: string;
  data: DashboardData;
}) {
  const { cluster_stats, affected_users, revenue_at_risk_usd, top_clusters, events_24h, total_events } = data;

  const totalEvents24h = events_24h.reduce((s, e) => s + e.count, 0);
  const maxSourceCount = Math.max(...events_24h.map((e) => e.count), 1);

  const empty = cluster_stats.active === 0 && total_events === 0;

  return (
    <div className="space-y-6">
      {/* ── KPI Cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<IconBug className="size-4" />}
          label="Open Issues"
          value={cluster_stats.active}
          sub={`${cluster_stats.investigating} under investigation`}
        />
        <StatCard
          icon={<IconAlertTriangle className="size-4" />}
          label="Critical"
          value={cluster_stats.critical}
          sub="priority score ≥ 7"
          accent={cluster_stats.critical > 0 ? "text-red-500" : ""}
        />
        <StatCard
          icon={<IconCurrencyDollar className="size-4" />}
          label="Revenue at Risk"
          value={fmtUsd(revenue_at_risk_usd)}
          sub="across open issues"
        />
        <StatCard
          icon={<IconUsers className="size-4" />}
          label="Affected Users"
          value={affected_users.toLocaleString()}
          sub={`${cluster_stats.resolved_30d} issues resolved (30d)`}
        />
      </div>

      {empty && (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <IconCircleCheck className="size-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            No data yet. Enable simulation or send real events to get started.
          </p>
        </div>
      )}

      {!empty && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ── Top Clusters ───────────────────────────────────────────── */}
          <div className="lg:col-span-2 rounded-lg border bg-card">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="text-sm font-semibold">Top Issues</h2>
              <Link
                href={`/projects/${slug}/issues`}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                View all →
              </Link>
            </div>

            {top_clusters.length === 0 ? (
              <p className="px-4 py-8 text-xs text-muted-foreground text-center">
                No open issues yet.
              </p>
            ) : (
              <div className="divide-y">
                {top_clusters.map((c) => (
                  <Link
                    key={c.id}
                    href={`/projects/${slug}/issues`}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40 transition-colors group"
                  >
                    {/* Score pill */}
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold ${scoreBg(c.priority_score)}`}
                    >
                      {fmtScore(c.priority_score)}
                    </span>

                    {/* Title + root cause */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{c.title}</p>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {c.root_cause}
                      </p>
                    </div>

                    {/* Meta */}
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <div className="flex items-center gap-1.5">
                        {c.github_issue_number && (
                          <IconBrandGithub className="size-3 text-muted-foreground" />
                        )}
                        <span className="text-[11px] text-muted-foreground font-mono">
                          {c.event_count} events
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground/60">
                        {timeAgo(c.last_seen)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* ── Right column ───────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            {/* Event volume by source */}
            <div className="rounded-lg border bg-card">
              <div className="flex items-center gap-2 px-4 py-3 border-b">
                <IconChartBar className="size-3.5 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Events (24 h)</h2>
                <span className="ml-auto text-xs text-muted-foreground font-mono">
                  {totalEvents24h.toLocaleString()} total
                </span>
              </div>

              {events_24h.length === 0 ? (
                <p className="px-4 py-6 text-xs text-muted-foreground text-center">
                  No events in the last 24 hours.
                </p>
              ) : (
                <div className="px-4 py-3 space-y-3">
                  {events_24h.map((s) => {
                    const pct = Math.round((s.count / maxSourceCount) * 100);
                    return (
                      <div key={s.source} className="space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-muted-foreground">
                            {SOURCE_LABEL[s.source] ?? s.source}
                          </span>
                          <span className="font-mono">{s.count.toLocaleString()}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-foreground/30"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Cluster health summary */}
            <div className="rounded-lg border bg-card">
              <div className="px-4 py-3 border-b">
                <h2 className="text-sm font-semibold">Health Summary</h2>
              </div>
              <div className="px-4 py-3 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Total events</span>
                  <span className="font-mono">{total_events.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Open issues</span>
                  <span className="font-mono">{cluster_stats.active}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className={`${cluster_stats.critical > 0 ? "text-red-500" : "text-muted-foreground"}`}>
                    Critical (≥7)
                  </span>
                  <span className={`font-mono ${cluster_stats.critical > 0 ? "text-red-500" : ""}`}>
                    {cluster_stats.critical}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Investigating</span>
                  <span className="font-mono">{cluster_stats.investigating}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Resolved (30d)</span>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-mono">
                    {cluster_stats.resolved_30d}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
