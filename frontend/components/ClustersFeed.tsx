"use client";

import { useEffect, useRef, useState } from "react";
import { IconRefresh } from "@tabler/icons-react";
import { type Cluster, type ClusterEvent, type ClustersPage, useClusters } from "@/lib/hooks/useClusters";
import { apiClient } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

// ── helpers ──────────────────────────────────────────────────────────────────

function priorityBadge(score: number) {
  if (score >= 0.7) return <Badge className="bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 border-0">Critical</Badge>;
  if (score >= 0.4) return <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400 border-0">High</Badge>;
  if (score >= 0.2) return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 border-0">Medium</Badge>;
  return               <Badge className="bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 border-0">Low</Badge>;
}

function statusBadge(status: Cluster["status"]) {
  const map: Record<Cluster["status"], "default" | "secondary" | "outline"> = {
    open: "default", investigating: "secondary", resolved: "outline",
  };
  return <Badge variant={map[status]}>{status}</Badge>;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function revenueLabel(score: number) {
  if (score >= 0.5)   return { text: "Critical revenue risk",  sub: "Severe payment failures or disputes — immediate action needed" };
  if (score >= 0.1)   return { text: "High revenue at risk",   sub: "Significant failed or disputed payments detected" };
  if (score >= 0.02)  return { text: "Medium revenue at risk", sub: "Failed or at-risk payment events present" };
  if (score > 0)      return { text: "Low revenue exposure",   sub: "Minor failed payment activity — worth monitoring" };
  return                     { text: "No revenue signal",      sub: "No failed, refunded, or disputed Stripe events in this cluster" };
}

function uxLabel(score: number) {
  if (score >= 0.7) return { text: "Severe user friction",  sub: "Rage clicks or error clicks dominating" };
  if (score >= 0.5) return { text: "High user friction",    sub: "Frequent frustration signals from users" };
  if (score >= 0.3) return { text: "Moderate friction",     sub: "Some frustration signals detected" };
  return                   { text: "Low friction",          sub: "Minimal UX frustration signals" };
}

function frequencyLabel(count: number) {
  if (count >= 50) return "Happening constantly";
  if (count >= 20) return "Recurring frequently";
  if (count >= 5)  return "Seen multiple times";
  return                  "Isolated occurrence";
}

// ── select-all checkbox (handles indeterminate state) ────────────────────────

function IndeterminateCheckbox({
  checked,
  indeterminate,
  onChange,
  onClick,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      onClick={onClick}
      className="h-4 w-4 rounded border-border accent-foreground cursor-pointer"
    />
  );
}

// ── source icon ───────────────────────────────────────────────────────────────

function SourceIcon({ source }: { source: string }) {
  const known = ["stripe", "sentry", "fullstory"];
  if (!known.includes(source)) return null;
  return (
    <img
      src={`/integrations-icns/${source}.svg`}
      alt={source}
      title={source}
      className="size-4 shrink-0"
    />
  );
}

// ── detail sheet ─────────────────────────────────────────────────────────────

function ClusterSheet({
  cluster, open, onClose, slug,
}: {
  cluster: Cluster | null;
  open: boolean;
  onClose: () => void;
  slug: string;
}) {
  const [tab, setTab]                         = useState<"overview" | "raw">("overview");
  const [payloads, setPayloads]               = useState<ClusterEvent[] | null>(null);
  const [payloadsLoading, setPayloadsLoading] = useState(false);
  const api = apiClient();

  // Reset when a different cluster is opened
  useEffect(() => {
    setTab("overview");
    setPayloads(null);
  }, [cluster?.id]);

  // Lazy-fetch event payloads the first time Raw tab is opened
  useEffect(() => {
    if (tab !== "raw" || payloads !== null || !cluster) return;
    setPayloadsLoading(true);
    api.get<Cluster>(`/api/projects/${slug}/clusters/${cluster.id}`)
      .then((d) => setPayloads(d.event_payloads ?? []))
      .catch(() => setPayloads([]))
      .finally(() => setPayloadsLoading(false));
  }, [tab, cluster?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cluster) return null;

  const rev = revenueLabel(cluster.revenue_score);
  const ux  = uxLabel(cluster.ux_score);

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="sm:max-w-xl w-full overflow-y-auto flex flex-col gap-0">
        <SheetHeader className="pb-0">
          <div className="flex items-center gap-2 flex-wrap">
            {priorityBadge(cluster.priority_score)}
            {statusBadge(cluster.status)}
          </div>
          <SheetTitle className="mt-2 leading-snug">{cluster.title}</SheetTitle>
          <SheetDescription>
            {cluster.event_count} events · {cluster.affected_users} user{cluster.affected_users !== 1 ? "s" : ""} · last seen {timeAgo(cluster.last_seen)}
          </SheetDescription>
        </SheetHeader>

        {/* tab bar */}
        <div className="flex border-b mx-4 mt-4">
          {(["overview", "raw"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                tab === t
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "overview" ? "Overview" : "Raw / Technical"}
            </button>
          ))}
        </div>

        {/* overview */}
        {tab === "overview" && (
          <div className="p-4 space-y-5 text-sm flex-1">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">What&apos;s happening</p>
              <p className="leading-relaxed">{cluster.root_cause}</p>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Impact</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border p-3 space-y-0.5">
                  <p className="text-xs text-muted-foreground">Revenue risk</p>
                  <p className="font-medium text-sm">{rev.text}</p>
                  <p className="text-[11px] text-muted-foreground">{rev.sub}</p>
                </div>
                <div className="rounded-md border p-3 space-y-0.5">
                  <p className="text-xs text-muted-foreground">User friction</p>
                  <p className="font-medium text-sm">{ux.text}</p>
                  <p className="text-[11px] text-muted-foreground">{ux.sub}</p>
                </div>
                <div className="rounded-md border p-3 space-y-0.5">
                  <p className="text-xs text-muted-foreground">Recurrence</p>
                  <p className="font-medium text-sm">{cluster.event_count} events</p>
                  <p className="text-[11px] text-muted-foreground">{frequencyLabel(cluster.event_count)}</p>
                </div>
                <div className="rounded-md border p-3 space-y-0.5">
                  <p className="text-xs text-muted-foreground">Blast radius</p>
                  <p className="font-medium text-sm">{cluster.affected_users} user{cluster.affected_users !== 1 ? "s" : ""}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {cluster.affected_users === 1 ? "Isolated to one user" : "Affects multiple users"}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Timeline</p>
              <p className="text-xs text-muted-foreground">
                First seen {timeAgo(cluster.first_seen)} · Last seen {timeAgo(cluster.last_seen)}
              </p>
            </div>
          </div>
        )}

        {/* raw / technical */}
        {tab === "raw" && (
          <div className="p-4 space-y-5 flex-1 min-h-0">

            {/* Event payloads — the primary content */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Event payloads considered ({cluster.event_count} total
                {cluster.event_count > 20 ? ", showing most recent 20" : ""})
              </p>

              {payloadsLoading && (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="rounded-md border h-24 bg-muted/30 animate-pulse" />
                  ))}
                </div>
              )}

              {!payloadsLoading && payloads && payloads.length === 0 && (
                <p className="text-xs text-muted-foreground">No event payloads found.</p>
              )}

              {!payloadsLoading && payloads && payloads.length > 0 && (
                <div className="space-y-2">
                  {payloads.map((ev) => (
                    <EventPayloadBlock key={ev.id} event={ev} />
                  ))}
                </div>
              )}
            </div>

            {/* Score breakdown — secondary */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Score breakdown</p>
              <div className="rounded-md border divide-y font-mono text-xs">
                {[
                  { label: "Revenue score",   value: cluster.revenue_score },
                  { label: "Frequency score", value: cluster.frequency_score },
                  { label: "UX score",        value: cluster.ux_score },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between px-3 py-2">
                    <span className="text-muted-foreground">{label}</span>
                    <span>{value.toFixed(4)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-2 bg-muted/40 font-semibold">
                  <span className="text-muted-foreground">Priority score</span>
                  <span>{cluster.priority_score.toFixed(4)}</span>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1.5">
                Weights are configurable in Settings → Prioritization
              </p>
            </div>

          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── collapsible event payload block ──────────────────────────────────────────

function EventPayloadBlock({ event }: { event: ClusterEvent }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-md border overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-muted/40 transition-colors"
      >
        <SourceIcon source={event.source} />
        <span className="font-mono font-medium flex-1 truncate">{event.event_type}</span>
        <span className="text-muted-foreground shrink-0">{timeAgo(event.received_at)}</span>
        <span className="text-muted-foreground ml-1">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <pre className="px-3 py-2 text-[11px] font-mono bg-muted/30 border-t overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── main feed ────────────────────────────────────────────────────────────────

export default function ClustersFeed({
  slug,
  initialData,
  initialCrossChannel = true,
}: {
  slug: string;
  initialData?: ClustersPage | null;
  initialCrossChannel?: boolean;
}) {
  const { data, loading, error, refetch } = useClusters(slug, initialData);
  const [evaluating, setEvaluating]         = useState(false);
  const [selected, setSelected]             = useState<Set<string>>(new Set());
  const [activeCluster, setActiveCluster]   = useState<Cluster | null>(null);
  const [crossChannel, setCrossChannel]     = useState(initialCrossChannel);
  const [togglingMode, setTogglingMode]     = useState(false);
  const api = apiClient();

  const clusters = data?.items ?? [];
  const allSelected     = clusters.length > 0 && selected.size === clusters.length;
  const someSelected    = selected.size > 0 && !allSelected;

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(clusters.map((c) => c.id)) : new Set());
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleEvaluate() {
    setEvaluating(true);
    try {
      await api.post(`/api/projects/${slug}/clusters/evaluate`);
      await refetch();
    } catch {
      // silently ignore
    } finally {
      setEvaluating(false);
    }
  }

  async function handleToggleCrossChannel(next: boolean) {
    setTogglingMode(true);
    try {
      await api.put(`/api/projects/${slug}/scoring-config`, { cross_channel: next });
      setCrossChannel(next);
      // re-evaluate so new events are clustered with the new mode
      await api.post(`/api/projects/${slug}/clusters/evaluate`);
      await refetch();
    } catch {
      // silently ignore
    } finally {
      setTogglingMode(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {data ? `${data.total} cluster${data.total !== 1 ? "s" : ""}` : ""}
          {selected.size > 0 && (
            <span className="ml-2 text-foreground font-medium">· {selected.size} selected</span>
          )}
        </p>

        <div className="flex items-center gap-4">
          {/* cross-channel toggle */}
          <div className="flex items-center gap-2">
            <Switch
              id="cross-channel"
              checked={crossChannel}
              onCheckedChange={handleToggleCrossChannel}
              disabled={togglingMode}
            />
            <label
              htmlFor="cross-channel"
              className="text-sm cursor-pointer select-none"
            >
              {crossChannel ? (
                <span>
                  Cross-channel correlation{" "}
                  <span className="text-muted-foreground font-normal">on</span>
                </span>
              ) : (
                <span>
                  Pattern-only clustering{" "}
                  <span className="text-muted-foreground font-normal">on</span>
                </span>
              )}
            </label>
          </div>

          <Button size="sm" variant="outline" onClick={handleEvaluate} disabled={evaluating || togglingMode} className="gap-2">
            <IconRefresh className={`size-4 ${evaluating ? "animate-spin" : ""}`} />
            Evaluate now
          </Button>
        </div>
      </div>

      {/* loading */}
      {loading && (
        <div className="rounded-lg border overflow-hidden">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 border-b last:border-b-0 bg-muted/30 animate-pulse" />
          ))}
        </div>
      )}

      {/* error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* empty */}
      {!loading && !error && clusters.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No clusters yet. Click &ldquo;Evaluate now&rdquo; to group your events.
          </p>
        </div>
      )}

      {/* table */}
      {!loading && clusters.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="w-10 px-3 py-2.5">
                  <IndeterminateCheckbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={toggleAll}
                  />
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground w-24">Priority</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Issue</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground w-20">Events</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground w-20">Users</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground w-28">Last seen</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground w-28">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {clusters.map((cluster) => (
                <tr
                  key={cluster.id}
                  onClick={() => setActiveCluster(cluster)}
                  className="hover:bg-muted/30 cursor-pointer transition-colors"
                >
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(cluster.id)}
                      onChange={() => toggleOne(cluster.id)}
                      className="h-4 w-4 rounded border-border accent-foreground cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-3">{priorityBadge(cluster.priority_score)}</td>
                  <td className="px-3 py-3 max-w-0">
                    <p className="font-medium truncate">{cluster.title}</p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{cluster.root_cause}</p>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground tabular-nums">{cluster.event_count}</td>
                  <td className="px-3 py-3 text-muted-foreground tabular-nums">{cluster.affected_users}</td>
                  <td className="px-3 py-3 text-muted-foreground">{timeAgo(cluster.last_seen)}</td>
                  <td className="px-3 py-3">{statusBadge(cluster.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* detail sheet */}
      <ClusterSheet
        cluster={activeCluster}
        open={activeCluster !== null}
        onClose={() => setActiveCluster(null)}
        slug={slug}
      />
    </div>
  );
}
