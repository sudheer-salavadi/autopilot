"use client";

import { useEffect, useRef, useState } from "react";
import { IconBrandGithub, IconExternalLink, IconFilter, IconRefresh, IconX } from "@tabler/icons-react";
import { JsonBlock } from "@/components/JsonBlock";
import { type Cluster, type ClusterEvent, type ClustersPage, type ClustersParams, useClusters } from "@/lib/hooks/useClusters";
import { apiClient } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

// ── count badge with tooltip ──────────────────────────────────────────────────

function CountBadge({ count, tooltip }: { count: number; tooltip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="shrink-0 rounded bg-muted-foreground/15 px-1 text-[10px] tabular-nums text-muted-foreground cursor-help">
          ×{count}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

// ── correlating attributes ────────────────────────────────────────────────────

function dig(obj: unknown, ...keys: string[]): string {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return "";
    cur = (cur as Record<string, unknown>)[k];
  }
  return typeof cur === "string" ? cur : "";
}

interface CrossMatch {
  value: string;
  sources: string[]; // deduplicated sources where this value was seen
  count: number;
}

interface Correlations {
  // Same value observed in 2+ distinct sources — the strongest signal
  crossSourceMatches: CrossMatch[];
  // Attributes unique to a single source
  singleSource: { source: string; label: string; entries: [string, number][] }[];
}

function computeCorrelations(payloads: ClusterEvent[]): Correlations {
  // Track each value → which sources it appeared in + total count
  type AttrInfo = { sources: Set<string>; count: number };
  const identityMap = new Map<string, AttrInfo>(); // emails, user/customer IDs
  const urlMap      = new Map<string, AttrInfo>(); // page URLs
  const errorTypes  = new Map<string, number>();
  const frustrations = new Map<string, number>();

  function track(map: Map<string, AttrInfo>, value: string, source: string) {
    const v = value?.trim();
    if (!v || v === "unknown" || v === "null" || v === "undefined") return;
    const e = map.get(v);
    if (e) { e.sources.add(source); e.count++; }
    else map.set(v, { sources: new Set([source]), count: 1 });
  }

  for (const ev of payloads) {
    const p = ev.payload as Record<string, unknown>;

    if (ev.source === "stripe") {
      const obj  = (p?.data as Record<string, unknown>)?.object as Record<string, unknown>;
      const meta = obj?.metadata as Record<string, unknown> | undefined;
      track(identityMap, String(obj?.customer  ?? ""), "stripe");
      track(identityMap, String(meta?.email    ?? ""), "stripe");
      track(identityMap, String(meta?.user_id  ?? ""), "stripe");

    } else if (ev.source === "sentry") {
      const data  = p?.data as Record<string, unknown>;
      const event = data?.event as Record<string, unknown>;
      const issue = data?.issue as Record<string, unknown>;
      const user  = event?.user as Record<string, unknown>;
      const req   = event?.request as Record<string, unknown>;
      const tags  = event?.tags as [string, string][] | undefined;

      track(identityMap, String(user?.email    ?? ""), "sentry");
      track(identityMap, String(user?.id       ?? ""), "sentry");
      track(urlMap,      String(req?.url        ?? ""), "sentry");

      // culprit as URL fallback
      const culprit = String(issue?.culprit ?? "");
      if (!req?.url && culprit.startsWith("http")) track(urlMap, culprit, "sentry");

      // customer_id from Sentry tags array
      if (Array.isArray(tags)) {
        for (const [k, v] of tags) {
          if (k === "customer_id" && v) track(identityMap, v, "sentry");
        }
      }

      const excVals = ((event?.exception as Record<string, unknown>)?.values as Record<string, unknown>[]) ?? [];
      const errType = String(excVals[0]?.type ?? "");
      if (errType) errorTypes.set(errType, (errorTypes.get(errType) ?? 0) + 1);

    } else { // fullstory
      const data = p?.data as Record<string, unknown>;
      track(identityMap, String(data?.user_email ?? ""), "fullstory");
      track(identityMap, String(data?.user_id    ?? ""), "fullstory");
      track(urlMap,      String(data?.page_url   ?? ""), "fullstory");
      const fr = String(data?.frustration_type ?? "");
      if (fr && fr !== "none") frustrations.set(fr, (frustrations.get(fr) ?? 0) + 1);
    }
  }

  // Separate cross-source (2+ sources) from single-source
  const crossIds:  CrossMatch[] = [];
  const crossUrls: CrossMatch[] = [];
  const singleIdentity = new Map<string, [string, number][]>(); // source → entries
  const singleUrl      = new Map<string, [string, number][]>();

  for (const [value, { sources, count }] of identityMap) {
    const srcList = [...sources];
    if (srcList.length >= 2) {
      crossIds.push({ value, sources: srcList, count });
    } else {
      const src = srcList[0];
      const arr = singleIdentity.get(src) ?? [];
      arr.push([value, count]);
      singleIdentity.set(src, arr);
    }
  }

  for (const [value, { sources, count }] of urlMap) {
    const srcList = [...sources];
    if (srcList.length >= 2) {
      crossUrls.push({ value, sources: srcList, count });
    } else {
      const src = srcList[0];
      const arr = singleUrl.get(src) ?? [];
      arr.push([value, count]);
      singleUrl.set(src, arr);
    }
  }

  const allCross = [
    ...crossIds,
    ...crossUrls,
  ].sort((a, b) => b.count - a.count).slice(0, 8);

  const singleSource: Correlations["singleSource"] = [];

  for (const [src, entries] of singleIdentity) {
    singleSource.push({
      source: src,
      label: "User / Customer",
      entries: entries.sort((a, b) => b[1] - a[1]).slice(0, 5),
    });
  }
  for (const [src, entries] of singleUrl) {
    singleSource.push({
      source: src,
      label: "Page URL",
      entries: entries.sort((a, b) => b[1] - a[1]).slice(0, 3),
    });
  }
  const errEntries = [...errorTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (errEntries.length) singleSource.push({ source: "sentry",    label: "Error type",  entries: errEntries });
  const frEntries  = [...frustrations.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (frEntries.length)  singleSource.push({ source: "fullstory", label: "Frustration", entries: frEntries });

  return { crossSourceMatches: allCross, singleSource };
}

// ── detail panel (shared between inline and sheet) ───────────────────────────

function ClusterDetail({
  cluster, slug, onClose, showClose = true, onClusterUpdated,
}: {
  cluster: Cluster;
  slug: string;
  onClose: () => void;
  showClose?: boolean;
  onClusterUpdated?: (updated: Partial<Cluster>) => void;
}) {
  const [tab, setTab]                         = useState<"overview" | "raw">("overview");
  const [payloads, setPayloads]               = useState<ClusterEvent[] | null>(null);
  const [payloadsLoading, setPayloadsLoading] = useState(false);
  const [toast, setToast]                     = useState(false);
  const [filingIssue, setFilingIssue]         = useState(false);
  const [issueError, setIssueError]           = useState("");
  const [resolving, setResolving]             = useState(false);
  const api = apiClient();

  async function handleResolve() {
    setResolving(true);
    try {
      await api.patch(`/api/projects/${slug}/clusters/${cluster.id}/status`, {
        status: "resolved",
      });
      onClusterUpdated?.({ status: "resolved" });
      onClose();
    } catch {
      // silently ignore — status unchanged
    } finally {
      setResolving(false);
    }
  }

  async function handleCreateIssue() {
    setFilingIssue(true);
    setIssueError("");
    try {
      const result = await api.post<{ issue_number: number; issue_url: string }>(
        `/api/projects/${slug}/clusters/${cluster.id}/github-issue`,
        {}
      );
      onClusterUpdated?.({
        github_issue_number: result.issue_number,
        github_issue_url: result.issue_url,
        status: "investigating",
      });
    } catch (err) {
      setIssueError(err instanceof Error ? err.message : "Failed to create issue");
    } finally {
      setFilingIssue(false);
    }
  }

  function copyToClipboard(val: string) {
    navigator.clipboard.writeText(val);
    setToast(true);
    setTimeout(() => setToast(false), 2500);
  }

  useEffect(() => {
    setTab("overview");
    setPayloads(null);
    setPayloadsLoading(true);
    api.get<Cluster>(`/api/projects/${slug}/clusters/${cluster.id}`)
      .then((d) => setPayloads(d.event_payloads ?? []))
      .catch(() => setPayloads([]))
      .finally(() => setPayloadsLoading(false));
  }, [cluster.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rev = revenueLabel(cluster.revenue_score);
  const ux  = uxLabel(cluster.ux_score);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-start gap-3 px-4 pt-4 pb-3 shrink-0 border-b">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {priorityBadge(cluster.priority_score)}
            {statusBadge(cluster.status)}
            {cluster.regression_count > 0 && (
              <Badge variant="outline" className="text-amber-600 border-amber-400 text-[10px]">
                Regression ×{cluster.regression_count}
              </Badge>
            )}
          </div>
          <h2 className="font-semibold text-sm leading-snug">{cluster.title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {cluster.event_count} events · {cluster.affected_users} user{cluster.affected_users !== 1 ? "s" : ""} · last seen {timeAgo(cluster.last_seen)}
          </p>

          {/* GitHub issue actions */}
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {cluster.github_issue_number ? (
              <a
                href={cluster.github_issue_url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <IconBrandGithub className="size-3.5" />
                #{cluster.github_issue_number}
                <IconExternalLink className="size-3" />
              </a>
            ) : (
              <button
                onClick={handleCreateIssue}
                disabled={filingIssue}
                className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <IconBrandGithub className="size-3.5" />
                {filingIssue ? "Filing…" : "Create GitHub issue"}
              </button>
            )}
          </div>
          {issueError && (
            <p className="text-[11px] text-destructive mt-1">{issueError}</p>
          )}

          {/* Resolve — only show for open/investigating clusters */}
          {cluster.status !== "resolved" && (
            <button
              onClick={handleResolve}
              disabled={resolving}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-emerald-600 transition-colors disabled:opacity-50"
            >
              {resolving ? "Resolving…" : "✓ Mark as resolved"}
            </button>
          )}
        </div>
        {showClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
          >
            <IconX className="size-4" />
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b px-4 shrink-0">
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
            {t === "overview" ? "Overview" : "Events"}
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0">

        {/* overview */}
        {tab === "overview" && (
          <div className="p-4 space-y-5 text-sm">
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
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Correlating attributes
              </p>
              {payloadsLoading && (
                <div className="rounded-md border divide-y">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-8 bg-muted/30 animate-pulse" />
                  ))}
                </div>
              )}
              {!payloadsLoading && payloads && (() => {
                const corr = computeCorrelations(payloads);
                const hasAny = corr.crossSourceMatches.length > 0 || corr.singleSource.length > 0;
                if (!hasAny) {
                  return <p className="text-xs text-muted-foreground">No common attributes detected across events.</p>;
                }
                return (
                  <div className="rounded-md border divide-y text-xs">

                    {/* ── cross-source matches (highest signal) ── */}
                    {corr.crossSourceMatches.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 bg-amber-50 dark:bg-amber-950/30">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                            Matched across sources
                          </p>
                        </div>
                        {corr.crossSourceMatches.map(({ value, sources, count }) => (
                          <div
                            key={value}
                            onClick={() => copyToClipboard(value)}
                            title={value}
                            className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors"
                          >
                            <div className="flex gap-0.5 shrink-0">
                              {sources.map((src) => <SourceIcon key={src} source={src} />)}
                            </div>
                            <span className="flex-1 font-mono break-all">{value}</span>
                            <CountBadge
                              count={count}
                              tooltip={`Appeared in ${count} event${count !== 1 ? "s" : ""} — matched across ${sources.join(" + ")}`}
                            />
                          </div>
                        ))}
                      </>
                    )}

                    {/* ── single-source signals ── */}
                    {corr.singleSource.filter((r) => r.entries.length > 0).map(({ source, label, entries }) => {
                      function entryTooltip(cnt: number): string {
                        if (label === "User / Customer") return `This identifier appeared in ${cnt} event${cnt !== 1 ? "s" : ""} from ${source}`;
                        if (label === "Page URL")        return `This page was involved in ${cnt} event${cnt !== 1 ? "s" : ""} from ${source}`;
                        if (label === "Error type")      return `This error type occurred ${cnt} time${cnt !== 1 ? "s" : ""}`;
                        if (label === "Frustration")     return `This frustration signal was recorded ${cnt} time${cnt !== 1 ? "s" : ""}`;
                        return `Seen ${cnt} time${cnt !== 1 ? "s" : ""}`;
                      }
                      return (
                        <div key={`${source}-${label}`} className="flex flex-col gap-2 px-3 py-2.5">
                          <div className="flex items-center gap-1.5 shrink-0">
                            <SourceIcon source={source} />
                            <span className="text-muted-foreground">{label}</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {entries.map(([val, cnt]) => (
                              <span
                                key={val}
                                onClick={() => copyToClipboard(val)}
                                title={val}
                                className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono cursor-pointer hover:bg-muted/60 transition-colors"
                              >
                                <span className="break-all">{val}</span>
                                <CountBadge count={cnt} tooltip={entryTooltip(cnt)} />
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}

                  </div>
                );
              })()}
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Timeline</p>
              <p className="text-xs text-muted-foreground">
                First seen {timeAgo(cluster.first_seen)} · Last seen {timeAgo(cluster.last_seen)}
              </p>
            </div>

            <div className="pt-1 border-t">
              <button
                onClick={() => setTab("raw")}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                View all events →
              </button>
            </div>
          </div>
        )}

        {/* raw / technical */}
        {tab === "raw" && (
          <div className="p-4 space-y-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Recent 20 events
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

      </div>

      {/* clipboard toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-md bg-foreground text-background text-xs px-3 py-2 shadow-lg pointer-events-none">
          Copied to clipboard
        </div>
      )}
    </div>
  );
}

// ── sheet wrapper (small screens only) ───────────────────────────────────────

function ClusterSheet({
  cluster, open, onClose, slug, onClusterUpdated,
}: {
  cluster: Cluster | null;
  open: boolean;
  onClose: () => void;
  slug: string;
  onClusterUpdated?: (patch: Partial<Cluster>) => void;
}) {
  if (!cluster) return null;
  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
        <SheetTitle className="sr-only">{cluster.title}</SheetTitle>
        <ClusterDetail cluster={cluster} slug={slug} onClose={onClose} showClose={false} onClusterUpdated={onClusterUpdated} />
      </SheetContent>
    </Sheet>
  );
}

// ── collapsible event payload block ──────────────────────────────────────────

function EventPayloadBlock({ event }: { event: ClusterEvent }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-md border overflow-hidden cursor-pointer">
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
        <JsonBlock value={event.payload} maxHeight="16rem" className="rounded-none border-0 border-t" />
      )}
    </div>
  );
}

// ── breakpoint hook ───────────────────────────────────────────────────────────

function useIsXl() {
  const [isXl, setIsXl] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    setIsXl(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsXl(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isXl;
}

// ── source filter pill ────────────────────────────────────────────────────────

const SOURCES = [
  { value: "", label: "All" },
  { value: "stripe", label: "Stripe" },
  { value: "sentry", label: "Sentry" },
  { value: "fullstory", label: "FullStory" },
] as const;

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
  // ── view / filter state ───────────────────────────────────────────────────
  const [view, setView]             = useState<"active" | "resolved">("active");
  const [filterSource, setSource]   = useState("");
  const [minScore, setMinScore]     = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  const params: ClustersParams = {
    view,
    source: filterSource || undefined,
    min_score: minScore > 0 ? minScore : undefined,
  };

  const { data, loading, error, refetch } = useClusters(slug, initialData, params);

  const [evaluating, setEvaluating]         = useState(false);
  const [selected, setSelected]             = useState<Set<string>>(new Set());
  const [activeCluster, setActiveCluster]   = useState<Cluster | null>(null);
  const [crossChannel, setCrossChannel]     = useState(initialCrossChannel);
  const [togglingMode, setTogglingMode]     = useState(false);
  const [detailWidth, setDetailWidth]       = useState(420);
  const [isDragging, setIsDragging]         = useState(false);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const isXl = useIsXl();
  const api = apiClient();

  const MIN_DETAIL = 280;
  const MAX_DETAIL = 760;

  function handleDragStart(e: React.MouseEvent) {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: detailWidth };
    setIsDragging(true);

    function onMove(e: MouseEvent) {
      if (!dragState.current) return;
      const delta = dragState.current.startX - e.clientX;
      setDetailWidth(Math.max(MIN_DETAIL, Math.min(MAX_DETAIL, dragState.current.startWidth + delta)));
    }
    function onUp() {
      dragState.current = null;
      setIsDragging(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Reset selection when view/filters change
  useEffect(() => { setSelected(new Set()); setActiveCluster(null); }, [view, filterSource, minScore]);

  // Apply optimistic updates to a cluster (e.g. after filing a GitHub issue)
  function handleClusterUpdated(id: string, patch: Partial<Cluster>) {
    if (activeCluster?.id === id) {
      setActiveCluster((c) => c ? { ...c, ...patch } : c);
    }
    if (patch.status === "resolved") {
      setActiveCluster(null);
      refetch();
    }
  }

  const clusters = data?.items ?? [];
  const allSelected = clusters.length > 0 && selected.size === clusters.length;
  const someSelected = selected.size > 0 && !allSelected;

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
    } catch { /* silently ignore */ } finally {
      setEvaluating(false);
    }
  }

  async function handleToggleCrossChannel(next: boolean) {
    setTogglingMode(true);
    try {
      await api.put(`/api/projects/${slug}/scoring-config`, { cross_channel: next });
      setCrossChannel(next);
      await api.post(`/api/projects/${slug}/clusters/evaluate`);
      await refetch();
    } catch { /* silently ignore */ } finally {
      setTogglingMode(false);
    }
  }

  const hasActiveFilters = filterSource !== "" || minScore > 0;

  return (
    <div className={`flex items-start${isDragging ? " select-none" : ""}`}>
      {/* left column */}
      <div className="flex-1 min-w-0 space-y-3">

        {/* ── Tab bar: Active / Resolved ─────────────────────────────── */}
        <div className="flex gap-1 border-b">
          {(["active", "resolved"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px capitalize ${
                view === v
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {v === "active" ? "Active" : "Resolved"}
              {data && view === v && (
                <span className="ml-1.5 text-[11px] text-muted-foreground font-mono">
                  ({data.total})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Toolbar ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <p className="text-sm text-muted-foreground">
            {data ? `${data.total} issue${data.total !== 1 ? "s" : ""}` : ""}
            {selected.size > 0 && (
              <span className="ml-2 text-foreground font-medium">· {selected.size} selected</span>
            )}
          </p>

          <div className="flex items-center gap-3">
            {view === "active" && (
              <>
                {/* filter toggle */}
                <button
                  onClick={() => setShowFilters((v) => !v)}
                  className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                    showFilters || hasActiveFilters
                      ? "border-foreground/40 bg-muted text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <IconFilter className="size-3.5" />
                  Filters
                  {hasActiveFilters && (
                    <span className="ml-0.5 rounded-full bg-foreground text-background text-[10px] px-1 leading-4">
                      {(filterSource ? 1 : 0) + (minScore > 0 ? 1 : 0)}
                    </span>
                  )}
                </button>

                {/* cross-channel toggle */}
                <div className="flex items-center gap-2">
                  <Switch
                    id="cross-channel"
                    checked={crossChannel}
                    onCheckedChange={handleToggleCrossChannel}
                    disabled={togglingMode}
                  />
                  <label htmlFor="cross-channel" className="text-sm cursor-pointer select-none">
                    {crossChannel
                      ? <span>Cross-channel <span className="text-muted-foreground font-normal">on</span></span>
                      : <span>Pattern-only <span className="text-muted-foreground font-normal">on</span></span>
                    }
                  </label>
                </div>

                <Button size="sm" variant="outline" onClick={handleEvaluate} disabled={evaluating || togglingMode} className="gap-2">
                  <IconRefresh className={`size-4 ${evaluating ? "animate-spin" : ""}`} />
                  Evaluate now
                </Button>
              </>
            )}
          </div>
        </div>

        {/* ── Filter bar (active view only) ──────────────────────────── */}
        {view === "active" && showFilters && (
          <div className="rounded-lg border bg-muted/20 px-4 py-3 space-y-3">
            {/* Source pills */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground w-16 shrink-0">Source</span>
              <div className="flex gap-1.5 flex-wrap">
                {SOURCES.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setSource(value)}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                      filterSource === value
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Min score slider */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-16 shrink-0">Min score</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={minScore}
                onChange={(e) => setMinScore(parseFloat(e.target.value))}
                className="flex-1 accent-foreground"
              />
              <span className="text-xs font-mono w-8 text-right">
                {minScore > 0 ? (minScore * 10).toFixed(1) : "off"}
              </span>
              {minScore > 0 && (
                <button onClick={() => setMinScore(0)} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                  Reset
                </button>
              )}
            </div>
          </div>
        )}

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
              {view === "resolved"
                ? "No resolved issues yet."
                : hasActiveFilters
                  ? "No issues match the current filters."
                  : "No open issues. Click \"Evaluate now\" to group your events."}
            </p>
            {view === "resolved" && (
              <p className="text-xs text-muted-foreground mt-1">
                Resolved issues will appear here once you close them.
              </p>
            )}
          </div>
        )}

        {/* table */}
        {!loading && clusters.length > 0 && (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  {view === "active" && (
                    <th className="w-10 px-3 py-2.5">
                      <IndeterminateCheckbox
                        checked={allSelected}
                        indeterminate={someSelected}
                        onChange={toggleAll}
                      />
                    </th>
                  )}
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground w-24">Priority</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Issue</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground w-20">Events</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground w-20">Users</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground w-28">
                    {view === "resolved" ? "Resolved" : "Last seen"}
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground w-28">Status</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {clusters.map((cluster) => (
                  <tr
                    key={cluster.id}
                    onClick={() => setActiveCluster(cluster)}
                    className={`cursor-pointer transition-colors ${
                      activeCluster?.id === cluster.id ? "bg-muted/50" : "hover:bg-muted/30"
                    }`}
                  >
                    {view === "active" && (
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(cluster.id)}
                          onChange={() => toggleOne(cluster.id)}
                          className="h-4 w-4 rounded border-border accent-foreground cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="px-3 py-3">{priorityBadge(cluster.priority_score)}</td>
                    <td className="px-3 py-3 max-w-0">
                      <p className="font-medium truncate">{cluster.title}</p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{cluster.root_cause}</p>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground tabular-nums">{cluster.event_count}</td>
                    <td className="px-3 py-3 text-muted-foreground tabular-nums">{cluster.affected_users}</td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {view === "resolved" ? timeAgo(cluster.updated_at) : timeAgo(cluster.last_seen)}
                    </td>
                    <td className="px-3 py-3">{statusBadge(cluster.status)}</td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      {cluster.github_issue_number && (
                        <a
                          href={cluster.github_issue_url ?? "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`GitHub #${cluster.github_issue_number}`}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <IconBrandGithub className="size-4" />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </div>{/* end left column */}

      {/* right column — resizable inline panel on xl */}
      {isXl && activeCluster && (
        <>
          {/* drag handle */}
          <div
            onMouseDown={handleDragStart}
            className="w-3 shrink-0 self-stretch flex items-center justify-center cursor-col-resize group"
          >
            <div className={`w-px h-full transition-colors ${isDragging ? "bg-foreground/40" : "bg-border group-hover:bg-foreground/30"}`} />
          </div>

          {/* detail panel */}
          <aside
            style={{ width: detailWidth }}
            className="shrink-0 flex flex-col sticky top-[calc(3rem+1px)] max-h-[calc(100vh-3rem-1px)] overflow-hidden -mr-6"
          >
            <ClusterDetail
              cluster={activeCluster}
              slug={slug}
              onClose={() => setActiveCluster(null)}
              onClusterUpdated={(patch) => handleClusterUpdated(activeCluster.id, patch)}
            />
          </aside>
        </>
      )}

      {/* sheet overlay — small screens only */}
      {isXl === false && (
        <ClusterSheet
          cluster={activeCluster}
          open={activeCluster !== null}
          onClose={() => setActiveCluster(null)}
          slug={slug}
          onClusterUpdated={(patch) => activeCluster && handleClusterUpdated(activeCluster.id, patch)}
        />
      )}
    </div>
  );
}
