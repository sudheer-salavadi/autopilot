"use client";

import Link from "next/link";
import {
  IconAlertTriangle,
  IconBrandGithub,
  IconBug,
  IconChartBar,
  IconChevronDown,
  IconChevronUp,
  IconChevronsDown,
  IconChevronsUp,
  IconCircleCheck,
  IconCurrencyDollar,
  IconMinus,
  IconUsers,
} from "@tabler/icons-react";

// ── Types ───────────────────────────────────────────────────────────────────
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

// ── Helpers ─────────────────────────────────────────────────────────────────
type SeverityLevel = "Critical" | "High" | "Medium" | "Low" | "Lowest";

function getSeverity(score: number): SeverityLevel {
  if (score >= 0.7)  return "Critical";
  if (score >= 0.4)  return "High";
  if (score >= 0.2)  return "Medium";
  if (score >= 0.05) return "Low";
  return "Lowest";
}

const SEVERITY_CFG: Record<SeverityLevel, { icon: React.ElementType; iconClass: string }> = {
  Critical: { icon: IconChevronsUp,   iconClass: "text-red-500 dark:text-red-400" },
  High:     { icon: IconChevronUp,    iconClass: "text-orange-500 dark:text-orange-400" },
  Medium:   { icon: IconMinus,        iconClass: "text-amber-500 dark:text-amber-400" },
  Low:      { icon: IconChevronDown,  iconClass: "text-green-500 dark:text-green-400" },
  Lowest:   { icon: IconChevronsDown, iconClass: "text-muted-foreground/50" },
};

function PriorityIcon({ score }: { score: number }) {
  const level = getSeverity(score);
  const { icon: Icon, iconClass } = SEVERITY_CFG[level];
  return <Icon className={`size-4 shrink-0 ${iconClass}`} />;
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
  stripe:    "Stripe",
  sentry:    "Sentry",
  fullstory: "FullStory",
  zendesk:   "Zendesk",
};

// ── StatCard ─────────────────────────────────────────────────────────────────
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
    <div className="rounded-lg border bg-card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground font-medium">{label}</span>
        <span className={`text-muted-foreground/60 ${accent ?? ""}`}>{icon}</span>
      </div>
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
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
      {/* ── KPI Cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<IconBug className="size-5" />}
          label="Open Issues"
          value={cluster_stats.active}
          sub={`${cluster_stats.investigating} under investigation`}
        />
        <StatCard
          icon={<IconAlertTriangle className="size-5" />}
          label="Critical"
          value={cluster_stats.critical}
          sub="priority score ≥ 7"
          accent={cluster_stats.critical > 0 ? "text-red-500" : ""}
        />
        <StatCard
          icon={<IconCurrencyDollar className="size-5" />}
          label="Revenue at Risk"
          value={fmtUsd(revenue_at_risk_usd)}
          sub="across open issues"
        />
        <StatCard
          icon={<IconUsers className="size-5" />}
          label="Affected Users"
          value={affected_users.toLocaleString()}
          sub={`${cluster_stats.resolved_30d} resolved in 30 days`}
        />
      </div>

      {empty && (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <IconCircleCheck className="size-12 text-muted-foreground/20" />
          <p className="text-muted-foreground">
            No data yet. Enable simulation or send real events to get started.
          </p>
        </div>
      )}

      {!empty && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ── Top Issues ───────────────────────────────────────────────── */}
          <div className="lg:col-span-2 rounded-lg border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3.5 border-b">
              <h2 className="font-semibold">Top Issues</h2>
              <Link
                href={`/projects/${slug}/issues`}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                View all →
              </Link>
            </div>

            {top_clusters.length === 0 ? (
              <p className="px-4 py-10 text-sm text-muted-foreground text-center">
                No open issues yet.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Issue</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground w-20">Events</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground w-20">Users</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground w-28">Last seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {top_clusters.map((c) => (
                    <tr
                      key={c.id}
                      className="hover:bg-muted/30 transition-colors cursor-pointer group"
                      onClick={() => window.location.href = `/projects/${slug}/issues`}
                    >
                      <td className="px-4 py-3 max-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <PriorityIcon score={c.priority_score} />
                          <div className="min-w-0">
                            <p className="font-medium truncate">{c.title}</p>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{c.root_cause}</p>
                          </div>
                          {c.github_issue_number && (
                            <IconBrandGithub className="size-3.5 shrink-0 text-muted-foreground/50" />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground tabular-nums">{c.event_count}</td>
                      <td className="px-4 py-3 text-muted-foreground tabular-nums">{c.affected_users}</td>
                      <td className="px-4 py-3 text-muted-foreground">{timeAgo(c.last_seen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Right column ─────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4">
            {/* Event volume by source */}
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3.5 border-b">
                <IconChartBar className="size-4 text-muted-foreground" />
                <h2 className="font-semibold">Events (24 h)</h2>
                <span className="ml-auto text-sm text-muted-foreground tabular-nums">
                  {totalEvents24h.toLocaleString()}
                </span>
              </div>

              {events_24h.length === 0 ? (
                <p className="px-4 py-8 text-sm text-muted-foreground text-center">
                  No events in the last 24 hours.
                </p>
              ) : (
                <div className="px-4 py-4 space-y-4">
                  {events_24h.map((s) => {
                    const pct = Math.round((s.count / maxSourceCount) * 100);
                    return (
                      <div key={s.source} className="space-y-1.5">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            {SOURCE_LABEL[s.source] ?? s.source}
                          </span>
                          <span className="tabular-nums font-medium">{s.count.toLocaleString()}</span>
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

            {/* Health Summary */}
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="px-4 py-3.5 border-b">
                <h2 className="font-semibold">Health Summary</h2>
              </div>
              <div className="px-4 py-4 space-y-3">
                {[
                  { label: "Total events", value: total_events.toLocaleString(), accent: false },
                  { label: "Open issues", value: cluster_stats.active, accent: false },
                  { label: "Critical (≥7)", value: cluster_stats.critical, accent: cluster_stats.critical > 0 },
                  { label: "Investigating", value: cluster_stats.investigating, accent: false },
                  { label: "Resolved (30d)", value: cluster_stats.resolved_30d, accent: false },
                ].map(({ label, value, accent }) => (
                  <div key={label} className="flex justify-between items-center text-sm">
                    <span className={accent ? "text-red-500" : "text-muted-foreground"}>{label}</span>
                    <span className={`tabular-nums font-medium ${accent ? "text-red-500" : ""}`}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
