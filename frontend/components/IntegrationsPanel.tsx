"use client";

import { useState } from "react";
import {
  IconBrandGithub,
  IconBrandStripe,
  IconBug,
  IconCircleFilled,
  IconPointer,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import IntegrationConfig from "@/components/IntegrationConfig";
import IntegrationPreview from "@/components/IntegrationPreview";

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
        icon: <IconBrandStripe className="size-5" />,
      },
      {
        type: "sentry",
        label: "Sentry",
        icon: <IconBug className="size-5" />,
      },
      {
        type: "fullstory",
        label: "FullStory",
        icon: <IconPointer className="size-5" />,
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
        disabled: true,
      },
    ],
  },
];

function StatusDot({ simulating, integration }: { simulating: boolean; integration?: Integration }) {
  if (simulating)
    return <IconCircleFilled className="size-1.5 text-blue-500 shrink-0 animate-pulse" />;
  if (!integration)
    return <IconCircleFilled className="size-1.5 text-muted-foreground/40 shrink-0" />;
  if (integration.is_active)
    return <IconCircleFilled className="size-1.5 text-emerald-500 shrink-0" />;
  return <IconCircleFilled className="size-1.5 text-amber-400 shrink-0" />;
}

function statusLabel(simulating: boolean, integration?: Integration) {
  if (simulating) return "Simulating";
  if (!integration) return "Not configured";
  return integration.is_active ? "Active" : "Inactive";
}

export default function IntegrationsPanel({
  project,
  initialIntegrations,
}: {
  project: Project;
  initialIntegrations: Integration[];
}) {
  const [integrations, setIntegrations] = useState(initialIntegrations);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [simulatingTypes, setSimulatingTypes] = useState<Set<string>>(new Set());

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
    setSimulatingTypes((prev) => {
      const next = new Set(prev);
      if (active) next.add(type);
      else next.delete(type);
      return next;
    });
  };

  return (
    <div className="flex h-[calc(100vh-10rem)]">
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
                      <StatusDot simulating={simulating} integration={configured} />
                      <span className="text-[11px] text-muted-foreground">
                        {item.disabled ? "Coming soon" : statusLabel(simulating, configured)}
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
      {!selectedType && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">
            Select an integration to configure
          </p>
        </div>
      )}
      {CATALOG.flatMap((g) => g.items)
        .filter((item) => !item.disabled)
        .map((item) => {
          const isVisible = selectedType === item.type;
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
