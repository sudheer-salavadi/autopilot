"use client";

import { useState } from "react";
import Image from "next/image";
import {
  IconBrandGithub,
  IconCircleFilled,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api";
import IntegrationConfig from "@/components/IntegrationConfig";
import IntegrationPreview from "@/components/IntegrationPreview";
import GitHubConfig, { type GithubConfig } from "@/components/GitHubConfig";

export interface Integration {
  id: string;
  project_id: string;
  type: string;
  is_active: boolean;
  config: Record<string, unknown>;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
}

const DEFAULT_GITHUB_CONFIG: GithubConfig = {
  project_id: "",
  repo: null,
  has_token: false,
  has_webhook_secret: false,
  autopilot_enabled: false,
  autopilot_min_score: 0.7,
};

type CatalogEntry = {
  type: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
};

const CATALOG: { group: string; items: CatalogEntry[] }[] = [
  {
    group: "Data Ingestion",
    items: [
      {
        type: "stripe",
        label: "Stripe",
        icon: <Image src="/integrations-icns/stripe.svg" alt="Stripe" width={20} height={20} />,
      },
      {
        type: "sentry",
        label: "Sentry",
        icon: <Image src="/integrations-icns/sentry.svg" alt="Sentry" width={20} height={20} />,
      },
      {
        type: "fullstory",
        label: "FullStory",
        icon: <Image src="/integrations-icns/fullstory.svg" alt="FullStory" width={20} height={20} />,
      },
    ],
  },
  {
    group: "Workflows",
    items: [
      {
        type: "github",
        label: "GitHub",
        icon: <IconBrandGithub className="size-5" />,
      },
    ],
  },
];

// ── educational empty state ───────────────────────────────────────────────────

const DATA_SOURCES = [
  {
    type: "stripe",
    label: "Stripe",
    color: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
    dot: "bg-violet-500",
    description: "Captures payment failures, disputes, subscription cancellations, and past-due invoices — the revenue impact signal.",
    signals: ["payment_intent.payment_failed", "charge.dispute.created", "invoice.payment_failed", "customer.subscription.deleted"],
  },
  {
    type: "sentry",
    label: "Sentry",
    color: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
    dot: "bg-rose-500",
    description: "Captures unhandled exceptions, error spikes, and crash reports — the code health signal.",
    signals: ["error.created (level: error)", "error.created (level: fatal)", "issue.resolved", "metric_alert.critical"],
  },
  {
    type: "fullstory",
    label: "FullStory",
    color: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
    dot: "bg-sky-500",
    description: "Captures rage clicks, dead clicks, and thrash patterns in user sessions — the UX frustration signal.",
    signals: ["frustration (rage_click)", "frustration (dead_click)", "frustration (thrash)", "frustration (error_click)"],
  },
];

function IntegrationsOverview() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-2 py-10 space-y-10">

        {/* Intro */}
        <div className="space-y-2">
          <h2 className="text-base font-semibold">How integrations work</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Autopilot connects to your existing tools to collect raw event signals. These events are
            grouped into <span className="text-foreground font-medium">issues</span> and scored so the
            highest-impact problems surface first — no manual triage needed.
          </p>
        </div>

        {/* Flow */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Pipeline</p>
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { label: "Your tools", sub: "Stripe · Sentry · FullStory", dim: false },
              null,
              { label: "Raw events", sub: "Webhooks or simulation", dim: true },
              null,
              { label: "Clustering", sub: "LLM groups by root cause", dim: true },
              null,
              { label: "Issues", sub: "Scored by severity", dim: false },
            ].map((step, i) =>
              step === null ? (
                <span key={i} className="text-muted-foreground/40 text-xs">→</span>
              ) : (
                <div key={i} className={`rounded-md border px-3 py-2 text-center ${step.dim ? "bg-muted/30" : "bg-card"}`}>
                  <p className="text-xs font-medium">{step.label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{step.sub}</p>
                </div>
              )
            )}
          </div>
        </div>

        {/* Data source cards */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Data Ingestion</p>
          <div className="space-y-3">
            {DATA_SOURCES.map((src) => (
              <div key={src.type} className="rounded-lg border bg-card p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Image src={`/integrations-icns/${src.type}.svg`} alt={src.label} width={20} height={20} />
                  <span className="text-sm font-semibold">{src.label}</span>
                  {/* <span className={`ml-auto text-[11px] font-medium rounded-full px-2.5 py-0.5 ${src.color}`}>
                    Data Ingestion
                  </span> */}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{src.description}</p>
                <div className="flex flex-wrap gap-1.5">
                  {src.signals.map((s) => (
                    <span key={s} className="rounded bg-muted/60 border px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Workflows */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Workflows</p>
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center gap-3">
              <IconBrandGithub className="size-5 text-foreground" />
              <span className="text-sm font-semibold">GitHub</span>
              {/* <span className="ml-auto text-[11px] font-medium rounded-full px-2.5 py-0.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                Workflow
              </span> */}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Connect your GitHub repo to let Autopilot file issues automatically when a cluster
              crosses your severity threshold. Issues are linked back to the cluster so you can
              track resolution end-to-end.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {["Auto-file on threshold", "Link cluster ↔ issue", "Mark resolved on close"].map((f) => (
                <span key={f} className="rounded bg-muted/60 border px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                  {f}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Getting started tip */}
        <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-4 flex gap-3">
          <span className="text-lg mt-0.5">💡</span>
          <div className="space-y-1">
            <p className="text-xs font-medium">Getting started</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Select an integration from the sidebar to configure it. You can use the{" "}
              <span className="text-foreground font-medium">Simulate</span> toggle on each data source
              to generate sample events instantly — no webhook setup required.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}

function StatusDot({ simulating, integration, connected }: { simulating: boolean; integration?: Integration; connected?: boolean }) {
  if (simulating)
    return <IconCircleFilled className="size-1.5 text-blue-500 shrink-0 animate-pulse" />;
  if (connected)
    return <IconCircleFilled className="size-1.5 text-emerald-500 shrink-0" />;
  if (!integration)
    return <IconCircleFilled className="size-1.5 text-muted-foreground/40 shrink-0" />;
  if (integration.is_active)
    return <IconCircleFilled className="size-1.5 text-emerald-500 shrink-0" />;
  return <IconCircleFilled className="size-1.5 text-amber-400 shrink-0" />;
}

function statusLabel(simulating: boolean, integration?: Integration, connected?: boolean) {
  if (simulating) return "Simulating";
  if (connected !== undefined) return connected ? "Connected" : "Not configured";
  if (!integration) return "Not configured";
  return integration.is_active ? "Active" : "Inactive";
}

export default function IntegrationsPanel({
  project,
  initialIntegrations,
  initialSimulatingTypes = [],
  initialGithubConfig,
}: {
  project: Project;
  initialIntegrations: Integration[];
  initialSimulatingTypes?: string[];
  initialGithubConfig?: GithubConfig;
}) {
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [simulatingTypes, setSimulatingTypes] = useState<Set<string>>(new Set(initialSimulatingTypes));
  const [githubConnected, setGithubConnected] = useState(
    !!(initialGithubConfig?.has_token && initialGithubConfig?.repo)
  );
  const api = apiClient();

  const configuredMap = new Map(integrations.map((i) => [i.type, i]));

  const handleSaved = (updated: Integration) => {
    setIntegrations((prev) => {
      const idx = prev.findIndex((i) => i.id === updated.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updated;
        return next;
      }
      return [...prev, updated];
    });
  };

  const handleSimulateToggle = (type: string, active: boolean) => {
    // Optimistic update — reflects immediately in UI
    setSimulatingTypes((prev) => {
      const next = new Set(prev);
      if (active) next.add(type);
      else next.delete(type);
      return next;
    });
    // Persist to server so simulation continues even after navigation
    api
      .post(`/api/projects/${project.slug}/integrations/${type}/simulate`, { active })
      .catch(() => {
        // Revert on failure
        setSimulatingTypes((prev) => {
          const next = new Set(prev);
          if (active) next.delete(type);
          else next.add(type);
          return next;
        });
      });
  };

  return (
    <div className="flex h-[calc(100vh-3rem)]">
      {/* Col 1 — catalog */}
      <div className="w-52 shrink-0 border-r flex flex-col overflow-y-auto">
        {CATALOG.map((group) => (
          <div key={group.group}>
            <p className="px-3 pt-4 pb-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              {group.group}
            </p>
            {group.items.map((item) => {
              const configured = configuredMap.get(item.type);
              const isSelected = selectedType === item.type;
              const simulating = simulatingTypes.has(item.type);
              const isGithub = item.type === "github";
              return (
                <button
                  key={item.type}
                  disabled={item.disabled}
                  onClick={() =>
                    setSelectedType(item.type === selectedType ? null : item.type)
                  }
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors",
                    "disabled:opacity-40 disabled:cursor-not-allowed",
                    isSelected
                      ? "bg-muted text-foreground"
                      : "hover:bg-muted/50 text-foreground/80"
                  )}
                >
                  <span className="shrink-0 text-muted-foreground">{item.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.label}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <StatusDot
                        simulating={simulating}
                        integration={isGithub ? undefined : configured}
                        connected={isGithub ? githubConnected : undefined}
                      />
                      <span className="text-[11px] text-muted-foreground">
                        {item.disabled
                          ? "Coming soon"
                          : statusLabel(
                              simulating,
                              isGithub ? undefined : configured,
                              isGithub ? githubConnected : undefined
                            )}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Cols 2 & 3 — always mounted to preserve state, visibility toggled */}
      {!selectedType && <IntegrationsOverview />}
      {CATALOG.flatMap((g) => g.items)
        .filter((item) => !item.disabled)
        .map((item) => {
          const isVisible = selectedType === item.type;
          if (item.type === "github") {
            return (
              <div
                key="github"
                className={cn("flex-1 overflow-y-auto p-6", !isVisible && "hidden")}
              >
                <GitHubConfig
                  slug={project.slug}
                  initialConfig={initialGithubConfig ?? DEFAULT_GITHUB_CONFIG}
                  onConfigSaved={(cfg) =>
                    setGithubConnected(!!(cfg.has_token && cfg.repo))
                  }
                />
              </div>
            );
          }
          return (
            <div key={item.type} className={cn("contents", !isVisible && "hidden")}>
              <IntegrationConfig
                project={project}
                type={item.type}
                integration={configuredMap.get(item.type)}
                isSimulating={simulatingTypes.has(item.type)}
                onSaved={handleSaved}
                onSimulateToggle={(active) => handleSimulateToggle(item.type, active)}
              />
              <IntegrationPreview
                slug={project.slug}
                source={item.type}
                isSimulating={simulatingTypes.has(item.type)}
              />
            </div>
          );
        })}
    </div>
  );
}
