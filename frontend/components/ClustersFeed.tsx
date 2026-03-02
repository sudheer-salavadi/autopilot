"use client";

import { useEffect, useRef, useState } from "react";
import { IconArrowDown, IconArrowUp, IconArrowsUpDown, IconBrandGithub, IconZoomQuestion, IconSparkles, IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp, IconChevronsDown, IconChevronsUp, IconExternalLink, IconHelpCircle, IconMinus, IconRefresh, IconSearch, IconX } from "@tabler/icons-react";
import { JsonBlock } from "@/components/JsonBlock";
import { type Cluster, type ClusterEvent, type ClustersPage, type ClustersParams, useClusters } from "@/lib/hooks/useClusters";
import { apiClient } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

/**
 * Highlights code-like tokens in a root_cause string:
 *   `backtick-wrapped`  → monospace chip
 *   /url/paths          → muted monospace
 *   snake_case          → monospace chip
 *   dot.notation        → monospace chip
 */
function formatRootCause(text: string): React.ReactNode {
  // Match in priority order: backtick > full URL > /path > currency > snake_case > dot.notation
  const pattern = /(`[^`]+`|https?:\/\/[^\s,;]+|\/[a-zA-Z][a-zA-Z0-9/_-]+|\$[\d,]+(?:\.\d{1,2})?|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\b[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]+)+\b)/g;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const isPath = token.startsWith("/") || token.startsWith("http");
    const isCurrency = token.startsWith("$");
    const display = token.startsWith("`") ? token.slice(1, -1) : token;

    if (isPath) {
      parts.push(
        <span key={key++} className="font-mono  bg-muted/80 text-foreground/80 px-1 py-0.5 rounded">
          {display}
        </span>
      );
    } else if (isCurrency) {
      parts.push(
        <span key={key++} className="font-mono  font-semibold px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300">
          {display}
        </span>
      );
    } else {
      parts.push(
        <code key={key++} className="font-mono bg-muted px-1 py-0.5 rounded text-foreground/90">
          {display}
        </code>
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 1 ? parts : text;
}

type SeverityLevel = "Critical" | "High" | "Medium" | "Low" | "Lowest";

function getSeverity(score: number): SeverityLevel {
  if (score >= 0.7)  return "Critical";
  if (score >= 0.4)  return "High";
  if (score >= 0.2)  return "Medium";
  if (score >= 0.05) return "Low";
  return "Lowest";
}

const SEVERITY_CFG: Record<SeverityLevel, {
  icon: React.ElementType;
  iconClass: string;
  badgeClass: string;
}> = {
  Critical: { icon: IconChevronsUp,   iconClass: "text-red-500 dark:text-red-400",    badgeClass: "bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 border-0" },
  High:     { icon: IconChevronUp,    iconClass: "text-orange-500 dark:text-orange-400", badgeClass: "bg-orange-100 text-orange-800 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400 border-0" },
  Medium:   { icon: IconMinus,        iconClass: "text-amber-500 dark:text-amber-400",  badgeClass: "bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 border-0" },
  Low:      { icon: IconChevronDown,  iconClass: "text-green-500 dark:text-green-400",  badgeClass: "bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 border-0" },
  Lowest:   { icon: IconChevronsDown, iconClass: "text-muted-foreground/50",            badgeClass: "bg-muted text-muted-foreground hover:bg-muted border-0" },
};

function priorityBadge(score: number) {
  const level = getSeverity(score);
  const { icon: Icon, iconClass, badgeClass } = SEVERITY_CFG[level];
  return (
    <Badge className={`gap-1 ${badgeClass}`}>
      <Icon className={`size-3 ${iconClass}`} />
      {level}
    </Badge>
  );
}

function PriorityIcon({ score }: { score: number }) {
  const level = getSeverity(score);
  const { icon: Icon, iconClass } = SEVERITY_CFG[level];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center">
          <Icon className={`size-4 shrink-0 ${iconClass}`} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{level}</TooltipContent>
    </Tooltip>
  );
}

function statusBadge(status: Cluster["status"]) {
  const map: Record<Cluster["status"], "default" | "secondary" | "outline"> = {
    open: "default", investigating: "secondary", resolved: "outline",
  };
  const labels: Record<Cluster["status"], string> = {
    open: "Open", investigating: "Investigating", resolved: "Resolved",
  };
  return (
    <Badge variant={map[status]} className="gap-1">
      {status === "resolved" && <IconCheck className="size-3" />}
      {labels[status]}
    </Badge>
  );
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
  const known = ["stripe", "sentry", "fullstory", "zendesk"];
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

// Strip query string + hash so /checkout?session=abc and /checkout?session=def
// both map to /checkout and can cross-match between Sentry and FullStory.
function normalizeUrl(raw: string): string {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    return u.origin + u.pathname;
  } catch {
    return raw; // relative paths or non-URL strings — return as-is
  }
}

interface CrossMatch {
  value: string;
  sources: string[]; // deduplicated sources where this value was seen
  count: number;
  type: "identity" | "url";
}

// Stripe customer IDs always start with cus_ — detect by value format so any tool
// that emits them (Sentry tags, FullStory custom vars, DataDog, etc.) routes correctly
const STRIPE_CUS_RE = /^cus_[a-zA-Z0-9_]+$/;

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

  // Route any identity value: cus_xxx format → always "stripe" regardless of which tool emitted it.
  // Emails are lowercased so admin@Company.com and admin@company.com pool together.
  function trackIdentity(value: string, defaultSource: string) {
    const v = value?.trim();
    if (!v) return;
    const src = STRIPE_CUS_RE.test(v) ? "stripe" : defaultSource;
    track(identityMap, v.includes("@") ? v.toLowerCase() : v, src);
  }

  // Tag/field names used by various providers to carry Stripe customer IDs
  const STRIPE_ID_FIELDS = new Set(["customer_id", "stripe_customer_id", "stripe_customer", "stripe_id"]);

  const sentryMessages    = new Map<string, number>(); // exception messages — tight signal for dedup
  const stripeErrors      = new Map<string, number>(); // Stripe failure codes — useful for CS routing
  const ticketPriorities  = new Map<string, number>(); // Zendesk ticket priority values
  const ticketTopics      = new Map<string, number>(); // Zendesk ticket tags

  for (const ev of payloads) {
    const p = ev.payload as Record<string, unknown>;

    if (ev.source === "stripe") {
      const obj  = (p?.data as Record<string, unknown>)?.object as Record<string, unknown>;
      const meta = obj?.metadata as Record<string, unknown> | undefined;
      trackIdentity(String(obj?.customer  ?? ""), "stripe");
      trackIdentity(String(meta?.email    ?? ""), "stripe");
      trackIdentity(String(meta?.user_id  ?? ""), "stripe");

      // Stripe failure / decline codes
      const lpe     = (obj?.last_payment_error ?? obj?.last_setup_error) as Record<string, unknown> | undefined;
      const errCode = String(lpe?.code ?? obj?.failure_code ?? "");
      if (errCode) stripeErrors.set(errCode, (stripeErrors.get(errCode) ?? 0) + 1);

    } else if (ev.source === "sentry") {
      const data  = p?.data as Record<string, unknown>;
      const event = data?.event as Record<string, unknown>;
      const issue = data?.issue as Record<string, unknown>;
      const user  = event?.user as Record<string, unknown>;
      const req   = event?.request as Record<string, unknown>;
      // Sentry webhooks send tags as array of tuples [["key","val"],…];
      // some API formats use an object — handle both
      const tagsRaw = event?.tags;
      const tags: [string, string][] = Array.isArray(tagsRaw)
        ? tagsRaw as [string, string][]
        : tagsRaw && typeof tagsRaw === "object"
          ? Object.entries(tagsRaw as Record<string, string>)
          : [];

      trackIdentity(String(user?.email ?? ""), "sentry");
      trackIdentity(String(user?.id    ?? ""), "sentry");
      track(urlMap, normalizeUrl(String(req?.url ?? "")), "sentry");

      // culprit as URL fallback
      const culprit = String(issue?.culprit ?? "");
      if (!req?.url && culprit.startsWith("http")) track(urlMap, normalizeUrl(culprit), "sentry");

      // Sentry tags: extract known Stripe ID field names; trackIdentity routes cus_xxx → "stripe"
      for (const [k, v] of tags) {
        if (STRIPE_ID_FIELDS.has(k) && v) trackIdentity(v, "sentry");
      }

      // Exception chain: Sentry stores innermost (root cause) last, outermost (wrapper) first
      const excVals = ((event?.exception as Record<string, unknown>)?.values as Record<string, unknown>[]) ?? [];
      const rootExc = excVals[excVals.length - 1]; // last = actual root cause
      const errType = String(rootExc?.type  ?? "");
      const errMsg  = String(rootExc?.value ?? "");
      if (errType) errorTypes.set(errType, (errorTypes.get(errType) ?? 0) + 1);
      // Cap message length — long values are often stack-trace noise, not a stable signal
      if (errMsg && errMsg.length <= 120) {
        sentryMessages.set(errMsg, (sentryMessages.get(errMsg) ?? 0) + 1);
      }

    } else if (ev.source === "zendesk") {
      // Real Zendesk schema: all ticket fields are in payload.detail (flat object)
      const detail = p?.detail as Record<string, unknown>;
      // external_id is the developer-set app user_id — the real cross-source hook.
      // When a developer sets ticket.requester.external_id to their app's user_id,
      // this will match against the same user_id seen in Stripe/Sentry payloads.
      const extId = String(detail?.external_id ?? "");
      if (extId && extId !== "null" && extId !== "undefined") {
        trackIdentity(extId, "zendesk");
      }
      // Zendesk-internal requester_id as a fallback (won't cross-correlate, but
      // useful for grouping multiple tickets from the same Zendesk user)
      const reqId = String(detail?.requester_id ?? "");
      if (reqId && reqId !== "null" && reqId !== "undefined") {
        trackIdentity(`zd:${reqId}`, "zendesk");
      }
      // Ticket priority as a UX severity signal
      const priority = String(detail?.priority ?? "");
      if (priority && priority !== "null" && priority !== "undefined") {
        ticketPriorities.set(priority, (ticketPriorities.get(priority) ?? 0) + 1);
      }
      // Ticket tags — topic clustering (e.g. "billing", "checkout", "login")
      const tags = detail?.tags as string[] | undefined;
      if (Array.isArray(tags)) {
        for (const tag of tags) {
          if (tag) ticketTopics.set(tag, (ticketTopics.get(tag) ?? 0) + 1);
        }
      }

    } else { // fullstory
      // Confirmed real FullStory webhook schema:
      // { eventName, version, data: { pageInfo: { pageUrl }, sessionUrl, userUrl,
      //   user_email, user_id, frustration_type, target_text, ... } }
      // pageInfo.pageUrl + sessionUrl + userUrl are system fields present on every event.
      // user_email, user_id, frustration_type are developer custom properties from FS.event().
      const data     = p?.data as Record<string, unknown> | undefined;
      const pageInfo = data?.pageInfo as Record<string, unknown> | undefined;

      // Identity: developer-set user_email / user_id in data, fallback to userUrl path segment
      const fsEmail = String(data?.user_email ?? data?.email ?? "");
      trackIdentity(fsEmail, "fullstory");
      const fsUserId = String(data?.user_id ?? "");
      trackIdentity(fsUserId, "fullstory");
      // userUrl system field: ends with /user/<userId> — extract ID for grouping
      const userUrl = String(data?.userUrl ?? "");
      if (userUrl) {
        const urlParts = userUrl.split("/");
        const fsInternalId = urlParts[urlParts.length - 1];
        if (fsInternalId) trackIdentity(fsInternalId, "fullstory");
      }

      // Developer custom properties may carry a Stripe customer ID
      for (const field of STRIPE_ID_FIELDS) {
        const v = String(data?.[field] ?? "");
        if (v) trackIdentity(v, "fullstory");
      }

      // Page URL: data.pageInfo.pageUrl (system field) → data.page_url (custom fallback)
      const fsUrl = String(pageInfo?.pageUrl ?? data?.page_url ?? "");
      track(urlMap, normalizeUrl(fsUrl), "fullstory");

      // Frustration: data.frustration_type (developer custom property), or event name itself
      const fr = String(data?.frustration_type ?? ev.event_type ?? "");
      if (fr && fr !== "none" && fr !== "session_start" && fr !== "session_end") {
        frustrations.set(fr, (frustrations.get(fr) ?? 0) + 1);
      }
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
      crossIds.push({ value, sources: srcList, count, type: "identity" });
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
      crossUrls.push({ value, sources: srcList, count, type: "url" });
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
      label: "User",
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
  if (errEntries.length) singleSource.push({ source: "sentry",    label: "Error type",    entries: errEntries });
  const frEntries  = [...frustrations.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (frEntries.length)  singleSource.push({ source: "fullstory", label: "Frustration",   entries: frEntries });
  const msgEntries = [...sentryMessages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (msgEntries.length) singleSource.push({ source: "sentry",    label: "Error message", entries: msgEntries });
  const stripeErrEntries = [...stripeErrors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (stripeErrEntries.length) singleSource.push({ source: "stripe", label: "Failure reason", entries: stripeErrEntries });

  // Zendesk: priority sorted by severity level, not count
  const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const priorityEntries = [...ticketPriorities.entries()]
    .sort((a, b) => (PRIORITY_ORDER[a[0]] ?? 4) - (PRIORITY_ORDER[b[0]] ?? 4));
  if (priorityEntries.length) singleSource.push({ source: "zendesk", label: "Ticket severity", entries: priorityEntries });

  const topicEntries = [...ticketTopics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (topicEntries.length) singleSource.push({ source: "zendesk", label: "Ticket topics", entries: topicEntries });

  // Surface the strongest signals first — order by top-entry count descending
  singleSource.sort((a, b) => (b.entries[0]?.[1] ?? 0) - (a.entries[0]?.[1] ?? 0));

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

  async function handleUnresolve() {
    setResolving(true);
    try {
      await api.patch(`/api/projects/${slug}/clusters/${cluster.id}/status`, {
        status: "open",
      });
      onClusterUpdated?.({ status: "open" });
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

  // Sum Stripe amounts (in cents) from the loaded event payloads.
  // Covers payment_intent.amount, invoice.amount_due, charge.amount etc.
  const stripeAmountCents = payloads
    ? payloads
        .filter((e) => e.source === "stripe")
        .reduce((sum, e) => {
          const obj = ((e.payload as Record<string, unknown>)?.data as Record<string, unknown>)
            ?.object as Record<string, unknown>;
          const amt =
            typeof obj?.amount === "number"     ? obj.amount :
            typeof obj?.amount_due === "number" ? obj.amount_due : 0;
          return sum + (amt as number);
        }, 0)
    : null;

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
          {/* <p className="text-xs text-muted-foreground mt-0.5">
            {cluster.event_count} events · {cluster.affected_users} user{cluster.affected_users !== 1 ? "s" : ""} · last seen {timeAgo(cluster.last_seen)}
          </p> */}

          {/* Actions row — GitHub + Resolve on one line, wraps if needed */}
          <div className="mt-2 flex items-center gap-x-5 gap-y-1 flex-wrap">
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

            {cluster.status !== "resolved" && (
              <button
                onClick={handleResolve}
                disabled={resolving}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors disabled:opacity-50"
              >
                {resolving ? "Resolving…" : "✓ Mark as resolved"}
              </button>
            )}

            {cluster.status === "resolved" && (
              <button
                onClick={handleUnresolve}
                disabled={resolving}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {resolving ? "Updating…" : "↩ Mark as unresolved"}
              </button>
            )}
          </div>
          {issueError && (
            <p className="text-[11px] text-destructive mt-1">{issueError}</p>
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
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1"> <IconZoomQuestion className="inline mr-1 size-3" /> What&apos;s happening</p>
              <p className="leading-relaxed">{formatRootCause(cluster.root_cause)}</p>
            </div>

          {/* PM Insight — the "what to do" synthesis */}
            {cluster.pm_insight && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1"><IconSparkles className="inline mr-1 size-3" />Recommended Solution</p>
              <p className="leading-relaxed">{cluster.pm_insight}</p>
            </div>
            )}      

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Impact</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border p-3 space-y-0.5">
                  <p className="text-xs text-muted-foreground">Revenue risk</p>
                  <p className="font-medium text-sm">{rev.text}</p>
                  {stripeAmountCents != null && stripeAmountCents > 0 && (
                    <p className="text-[11px] font-semibold tabular-nums">
                      {new Intl.NumberFormat("en-US", {
                        style: "currency", currency: "USD", maximumFractionDigits: 0,
                      }).format(stripeAmountCents / 100)}
                      {" "}in Stripe events
                    </p>
                  )}
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
                Signals
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

                // Map single-source labels to reader-friendly section headings
                function sectionHeading(label: string, source: string): string {
                  if (label === "User" && source === "stripe") return "Stripe billing accounts in error logs";
                  if (label === "User" && source === "zendesk") return "Customers who filed tickets";
                  if (label === "User")           return "Who's affected";
                  if (label === "Page URL")        return "Where it's happening";
                  if (label === "Error type")      return "What's breaking";
                  if (label === "Error message")   return "What the error says";
                  if (label === "Failure reason")  return "Stripe failure codes";
                  if (label === "Frustration")     return "How bad the experience is";
                  if (label === "Ticket severity") return "Support ticket urgency";
                  if (label === "Ticket topics")   return "What customers are reporting";
                  return label;
                }
                function entryTooltip(label: string, source: string, cnt: number): string {
                  if (label === "User" && source === "stripe")
                    return `This Stripe billing account appeared in ${cnt} event${cnt !== 1 ? "s" : ""} in this issue`;
                  if (label === "User" && source === "zendesk")
                    return `This customer filed or is linked to ${cnt} ticket${cnt !== 1 ? "s" : ""} in this issue`;
                  if (label === "User")
                    return `Seen in ${cnt} ${source} event${cnt !== 1 ? "s" : ""} in this issue`;
                  if (label === "Page URL")
                    return `This page appeared in ${cnt} ${source} event${cnt !== 1 ? "s" : ""} in this issue`;
                  if (label === "Error type")
                    return `Thrown ${cnt} time${cnt !== 1 ? "s" : ""} across events in this issue`;
                  if (label === "Error message")
                    return `This exact error message appeared ${cnt} time${cnt !== 1 ? "s" : ""} in this issue`;
                  if (label === "Failure reason")
                    return `Stripe returned this decline code ${cnt} time${cnt !== 1 ? "s" : ""} in this issue`;
                  if (label === "Frustration")
                    return `Recorded ${cnt} time${cnt !== 1 ? "s" : ""} across FullStory sessions in this issue`;
                  if (label === "Ticket severity")
                    return `${cnt} Zendesk ticket${cnt !== 1 ? "s" : ""} at this priority level in this issue`;
                  if (label === "Ticket topics")
                    return `This tag appeared on ${cnt} Zendesk ticket${cnt !== 1 ? "s" : ""} in this issue`;
                  return `Seen ${cnt} time${cnt !== 1 ? "s" : ""} in this issue`;
                }

                return (
                  <div className="rounded-md border divide-y text-xs">

                    {/* ── cross-source identities: same person seen in 2+ tools ── */}
                    {corr.crossSourceMatches.filter(m => m.type === "identity").length > 0 && (() => {
                      const rows = corr.crossSourceMatches.filter(m => m.type === "identity");
                      return (
                        <>
                          <div className="px-3 py-1.5 bg-amber-50 dark:bg-amber-950/30 flex items-center justify-between border-b-0">
                            <p className="text-muted-foreground font-medium">
                              Affected users — seen across multiple tools
                            </p>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-muted-foreground/60 cursor-help text-[10px]">?</span>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-52 text-xs">
                                The same email or user ID appeared in events from 2+ services — e.g. the same person triggered a Sentry error AND a FullStory frustration signal. Highest-priority users to investigate or contact.
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          {rows.map(({ value, sources, count }) => (
                            <div
                              key={value}
                              onClick={() => copyToClipboard(value)}
                              title={value}
                              className="flex items-center gap-2 py-2 mx-3 cursor-pointer hover:bg-muted/40 transition-colors"
                            >
                              <div className="flex gap-0.5 shrink-0">
                                {sources.map((src) => <SourceIcon key={src} source={src} />)}
                              </div>
                              <span className="flex-1 font-mono break-all">{value}</span>
                              <CountBadge
                                count={count}
                                tooltip={`Found in ${count} event${count !== 1 ? "s" : ""} in this issue, across ${sources.join(" + ")}`}
                              />
                            </div>
                          ))}
                        </>
                      );
                    })()}

                    {/* ── cross-source URLs: same page flagged by 2+ tools ── */}
                    {corr.crossSourceMatches.filter(m => m.type === "url").length > 0 && (() => {
                      const rows = corr.crossSourceMatches.filter(m => m.type === "url");
                      return (
                        <>
                          <div className="px-3 py-1.5 bg-blue-50 dark:bg-blue-950/30 flex items-center justify-between border-b-0">
                            <p className="text-[10px] font-semibold uppercase tracking-wider">
                              Shared pages — flagged by multiple tools
                            </p>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-muted-foreground/60 cursor-help text-[10px]">?</span>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-52 text-xs">
                                The same URL appeared in events from 2+ services — e.g. Sentry logged an error on a page where FullStory also recorded a rage-click. High confidence the bug is on this specific page.
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          {rows.map(({ value, sources, count }) => (
                            <div
                              key={value}
                              onClick={() => copyToClipboard(value)}
                              title={value}
                              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors"
                            >
                              <div className="flex gap-0.5 shrink-0">
                                {sources.map((src) => <SourceIcon key={src} source={src} />)}
                              </div>
                              <span className="flex-1 font-mono truncate">{value}</span>
                              <CountBadge
                                count={count}
                                tooltip={`This URL appeared in ${count} event${count !== 1 ? "s" : ""} in this issue, across ${sources.join(" + ")}`}
                              />
                            </div>
                          ))}
                        </>
                      );
                    })()}

                    {/* ── single-source signals with narrative headings ── */}
                    {corr.singleSource.filter((r) => r.entries.length > 0).map(({ source, label, entries }) => (
                      <div key={`${source}-${label}`} className="flex flex-col gap-2 px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <SourceIcon source={source} />
                          <span className="text-muted-foreground font-medium">
                            {sectionHeading(label, source)}
                          </span>
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
                              <CountBadge count={cnt} tooltip={entryTooltip(label, source, cnt)} />
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}

                  </div>
                );
              })()}
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Timeline</p>
              <p className="text-xs text-muted-foreground">
                Issue first seen {timeAgo(cluster.first_seen)} · most recent event {timeAgo(cluster.last_seen)}
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
                  <span className="text-muted-foreground">Severity score</span>
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

// ── sortable column header ────────────────────────────────────────────────────

type SortKey = "priority_score" | "event_count" | "affected_users" | "last_seen";

function SortableHeader({
  label, sortKey, currentSortBy, currentSortDir, onSort,
}: {
  label: string;
  sortKey: SortKey;
  currentSortBy: SortKey | null;
  currentSortDir: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  const active = currentSortBy === sortKey;
  const Icon = active
    ? currentSortDir === "asc" ? IconArrowUp : IconArrowDown
    : IconArrowsUpDown;
  return (
    <button
      onClick={() => onSort(sortKey)}
      className="flex items-center gap-1 group select-none"
    >
      {label}
      <Icon className={`size-3 transition-opacity ${active ? "opacity-80" : "opacity-0 group-hover:opacity-40"}`} />
    </button>
  );
}

// ── source filter pill ────────────────────────────────────────────────────────

// ── main feed ────────────────────────────────────────────────────────────────

export default function ClustersFeed({
  slug,
  initialData,
}: {
  slug: string;
  initialData?: ClustersPage | null;
}) {
  // ── view / filter / sort / page state ────────────────────────────────────
  const [view, setView]               = useState<"active" | "resolved">("active");
  const [search, setSearch]           = useState("");
  const [sortBy, setSortBy]           = useState<SortKey | null>(null);
  const [sortDir, setSortDir]         = useState<"asc" | "desc">("desc");
  const [page, setPage]               = useState(1);

  const PAGE_SIZE = 20;

  const params: ClustersParams = { view };

  const { data, loading, error, refetch } = useClusters(slug, initialData, params);

  const [evaluating, setEvaluating]         = useState(false);
  const [selected, setSelected]             = useState<Set<string>>(new Set());
  const [activeCluster, setActiveCluster]   = useState<Cluster | null>(null);
  const [showHelp, setShowHelp]             = useState(false);
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

  function handleSort(key: SortKey) {
    if (sortBy !== key) { setSortBy(key); setSortDir("desc"); }
    else if (sortDir === "desc") { setSortDir("asc"); }
    else { setSortBy(null); }
    setPage(1);
  }

  // Reset selection + page when view/search/sort change
  useEffect(() => { setSelected(new Set()); setActiveCluster(null); setPage(1); }, [view, search]);

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

  const allClusters = data?.items ?? [];

  // 1. Search filter
  const q = search.trim().toLowerCase();
  const searched = q
    ? allClusters.filter((c) =>
        c.title.toLowerCase().includes(q) || c.root_cause.toLowerCase().includes(q)
      )
    : allClusters;

  // 2. Sort
  const sorted = sortBy
    ? [...searched].sort((a, b) => {
        let diff: number;
        if (sortBy === "last_seen") {
          diff = new Date(a.last_seen).getTime() - new Date(b.last_seen).getTime();
        } else {
          diff = (a[sortBy] as number) - (b[sortBy] as number);
        }
        return sortDir === "asc" ? diff : -diff;
      })
    : searched;

  // 3. Paginate
  const totalItems  = sorted.length;
  const totalPages  = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const pageStart   = (clampedPage - 1) * PAGE_SIZE;
  const clusters    = sorted.slice(pageStart, pageStart + PAGE_SIZE);

  const allSelected = clusters.length > 0 && clusters.every((c) => selected.has(c.id));
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


  return (
    <div className={`flex -mt-6 items-start${isDragging ? " select-none" : ""}`}>
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
              {v === "active" ? "Open" : "Resolved"}
            </button>
          ))}
        </div>

        {/* ── Toolbar ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          {/* Search — always visible */}
          <div className="relative flex-1">
            <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search by title or root cause…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <IconX className="size-3" />
              </button>
            )}
          </div>

          <p className="text-xs text-muted-foreground shrink-0">
            {data ? `${totalItems} issue${totalItems !== 1 ? "s" : ""}` : ""}
            {selected.size > 0 && (
              <span className="ml-1.5 text-foreground font-medium">· {selected.size} selected</span>
            )}
          </p>

          {view === "active" && (
            <Button size="sm" variant="outline" onClick={handleEvaluate} disabled={evaluating} className="gap-2 shrink-0">
              <IconRefresh className={`size-4 ${evaluating ? "animate-spin" : ""}`} />
              Evaluate now
            </Button>
          )}

          <button
            onClick={() => setShowHelp(true)}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="How issues work"
          >
            <IconHelpCircle className="size-4" />
          </button>
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
        {!loading && !error && totalItems === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {view === "resolved"
                ? "No resolved issues yet."
                : search
                  ? "No issues match your search."
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
        {!loading && totalItems > 0 && (
          <div className="rounded-lg overflow-hidden">
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
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">
                    <SortableHeader label="Issue" sortKey="priority_score" currentSortBy={sortBy} currentSortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground w-20">
                    <SortableHeader label="Events" sortKey="event_count" currentSortBy={sortBy} currentSortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground w-20">
                    <SortableHeader label="Users" sortKey="affected_users" currentSortBy={sortBy} currentSortDir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground w-28">
                    <SortableHeader
                      label={view === "resolved" ? "Resolved" : "Last seen"}
                      sortKey="last_seen"
                      currentSortBy={sortBy}
                      currentSortDir={sortDir}
                      onSort={handleSort}
                    />
                  </th>
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
                    <td className="px-3 py-3 max-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <PriorityIcon score={cluster.priority_score} />
                        <span className="font-medium truncate">{cluster.title}</span>
                        {cluster.github_issue_number && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <a
                                href={cluster.github_issue_url ?? "#"}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors"
                              >
                                <IconBrandGithub className="size-3.5" />
                              </a>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {cluster.status === "resolved"
                                ? `Resolved via GitHub #${cluster.github_issue_number}`
                                : `GitHub #${cluster.github_issue_number}`}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground tabular-nums">{cluster.event_count}</td>
                    <td className="px-3 py-3 text-muted-foreground tabular-nums">{cluster.affected_users}</td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {view === "resolved" ? timeAgo(cluster.updated_at) : timeAgo(cluster.last_seen)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination footer */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-3 py-2 border-t bg-muted/20">
                <p className="text-xs text-muted-foreground">
                  {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, totalItems)} of {totalItems}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={clampedPage === 1}
                    className="p-1 rounded border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Previous page"
                  >
                    <IconChevronLeft className="size-3.5" />
                  </button>
                  <span className="text-xs text-muted-foreground px-2 tabular-nums">
                    {clampedPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={clampedPage === totalPages}
                    className="p-1 rounded border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Next page"
                  >
                    <IconChevronRight className="size-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

      {/* ── How it works sheet ──────────────────────────────────────── */}
      <Sheet open={showHelp} onOpenChange={setShowHelp}>
        <SheetContent side="right" className="w-full sm:max-w-xl p-6 overflow-y-auto">
          <SheetTitle className="flex items-center gap-2 mb-6">
            <IconHelpCircle className="size-4 text-muted-foreground" />
            How Issues work
          </SheetTitle>
          <div className="space-y-7 text-sm pr-1">

            {/* pipeline */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">The pipeline</p>
              <p className="text-muted-foreground leading-relaxed">
                Raw events from Stripe, Sentry, FullStory, and Zendesk flow in via webhooks or simulation.
                Autopilot groups them into <span className="text-foreground font-medium">issues</span> — clusters
                of events that share the same underlying root cause — and scores each one so the
                highest-impact problems surface first.
              </p>
              <div className="rounded-md border bg-muted/30 p-3 font-mono text-xs leading-6 text-muted-foreground">
                <p>Stripe event  ──┐</p>
                <p>Sentry event  ──┼──▶  LLM grouping  ──▶  Issue  ──▶  Score</p>
                <p>FullStory     ──┘         (every 2 min)         Revenue × w1</p>
                <p>                                                Frequency × w2</p>
                <p>                                                UX Impact × w3</p>
              </div>
            </div>

            {/* scoring */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Severity score</p>
              <p className="text-muted-foreground leading-relaxed">
                Each issue gets a score from 0–1 based on three signals, each normalised against
                your configured thresholds (Settings → Prioritization):
              </p>
              <div className="rounded-md border bg-muted/30 p-3 font-mono text-xs leading-6 text-muted-foreground space-y-1">
                <p>Revenue    = sum of $ at risk  ÷  max_revenue_usd</p>
                <p>Frequency  = event count       ÷  max_frequency_count</p>
                <p>UX Impact  = avg frustration signal per event</p>
                <p className="pt-1 text-foreground">Score = (Rev × w1) + (Freq × w2) + (UX × w3)</p>
              </div>
              <div className="rounded-md border divide-y text-xs">
                {[
                  { badge: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",    label: "Critical", range: "≥ 0.7" },
                  { badge: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400", label: "High",     range: "0.4 – 0.69" },
                  { badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",  label: "Medium",   range: "0.2 – 0.39" },
                  { badge: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",  label: "Low",      range: "0.05 – 0.19" },
                  { badge: "bg-muted text-muted-foreground",                                   label: "Lowest",   range: "< 0.05" },
                ].map(({ badge, label, range }) => (
                  <div key={label} className="flex items-center justify-between px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge}`}>{label}</span>
                    <span className="font-mono text-muted-foreground">{range}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* correlating attributes */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Correlating attributes</p>
              <p className="text-muted-foreground leading-relaxed">
                When you open an issue, Autopilot scans every event in the cluster and extracts
                identifiers — emails, user IDs, page URLs, error types, and frustration signals.
                It then answers two questions:
              </p>
              <div className="rounded-md border bg-muted/30 p-3 font-mono text-xs leading-6 text-muted-foreground space-y-2">
                <p><span className="text-foreground">Who is affected across all your tools?</span></p>
                <p>  user@co.com seen in Sentry error + FullStory rage-click</p>
                <p>  → same person, broken experience end-to-end</p>
                <p className="pt-1"><span className="text-foreground">Where and what is concentrated within each tool?</span></p>
                <p>  Sentry: RateLimitError ×4, TimeoutError ×3</p>
                <p>  FullStory: /checkout ×6, rage_click ×6</p>
                <p>  Zendesk: urgent ×2, tag:billing ×3</p>
              </div>
              <div className="space-y-2.5 text-xs text-muted-foreground">
                <div className="flex gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0 mt-1" />
                  <p><span className="text-foreground font-medium">Affected users</span> — email addresses and app user IDs (e.g. <code className="font-mono bg-muted px-1 rounded">user_789</code>) seen in 2+ tools for this issue. These are your highest-priority people to contact or investigate.</p>
                </div>
                <div className="flex gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0 mt-1" />
                  <p><span className="text-foreground font-medium">Stripe billing accounts</span> — Stripe customer IDs (<code className="font-mono bg-muted px-1 rounded">cus_xxx</code>) extracted from Stripe events and any <code className="font-mono bg-muted px-1 rounded">customer_id</code> tags in Sentry. These are billing entities, not necessarily the same as your app's user accounts.</p>
                </div>
                <div className="flex gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0 mt-1" />
                  <p><span className="text-foreground font-medium">Where it's happening</span> — page URLs concentrated in one service. If the same URL appears in FullStory sessions and Sentry errors, the bug is likely on that page.</p>
                </div>
                <div className="flex gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0 mt-1" />
                  <p><span className="text-foreground font-medium">What's breaking</span> — repeated exception class names from Sentry. The most frequent error type is usually the root cause to fix.</p>
                </div>
                <div className="flex gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0 mt-1" />
                  <p><span className="text-foreground font-medium">User experience signal</span> — FullStory frustration types (rage click, dead click, thrash). Rage clicks on the same element confirm users are actively hitting the broken state.</p>
                </div>
              </div>
            </div>

            {/* github */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">GitHub issues</p>
              <p className="text-muted-foreground leading-relaxed">
                Autopilot only files a GitHub issue when the cluster is <span className="text-foreground font-medium">engineering-actionable</span> — meaning it contains at least one non-Stripe event, or a Stripe error that's caused by your code (e.g. <code className="font-mono bg-muted px-1 rounded">invalid_request_error</code>), not a customer's bank declining their card.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Customer-side failures like <code className="font-mono bg-muted px-1 rounded">insufficient_funds</code> or <code className="font-mono bg-muted px-1 rounded">card_expired</code> are surfaced in the Issues feed but do not create GitHub noise — they belong to Customer Success, not engineering.
              </p>
            </div>

          </div>
        </SheetContent>
      </Sheet>

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
