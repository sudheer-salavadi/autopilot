"use client";

import { useState } from "react";
import { IconCheck, IconCopy, IconRefresh } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api";
import type { Integration, Project } from "@/components/IntegrationsPanel";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface Props {
  project: Project;
  type: string;
  integration?: Integration;
  isSimulating: boolean;
  onSaved: (updated: Integration) => void;
  onSimulateToggle: (active: boolean) => void;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function IntegrationConfig({
  project,
  type,
  integration,
  isSimulating,
  onSaved,
  onSimulateToggle,
}: Props) {
  const isStripe = type === "stripe";
  const currentMode = (integration?.config as Record<string, unknown>)?.mode ?? "webhook";

  const [mode, setMode] = useState<"webhook" | "mcp">(
    isStripe && currentMode === "mcp" ? "mcp" : "webhook"
  );
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // MCP-specific state
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ pulled: number } | null>(null);
  const [syncError, setSyncError] = useState("");
  const lastSync = (integration?.config as Record<string, unknown>)?.last_mcp_sync as string | undefined;

  const api = apiClient();
  const webhookUrl = `${API_URL}/api/webhooks/${project.id}/${type}`;

  const copy = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const payload =
        isStripe && mode === "mcp"
          ? {
              webhook_secret: secret,
              is_active: true,
              config: {
                ...((integration?.config as object) ?? {}),
                mode: "mcp",
              },
            }
          : {
              webhook_secret: secret,
              ...(isStripe
                ? { config: { ...((integration?.config as object) ?? {}), mode: "webhook" } }
                : {}),
            };

      let result: Integration;
      if (integration) {
        result = await api.put<Integration>(
          `/api/projects/${project.slug}/integrations/${integration.id}`,
          payload
        );
      } else {
        result = await api.post<Integration>(
          `/api/projects/${project.slug}/integrations`,
          { type, ...payload }
        );
      }
      setSecret("");
      onSaved(result);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to save";
      setError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncError("");
    setSyncResult(null);
    try {
      const result = await api.post<{ pulled: number }>(
        `/api/projects/${project.slug}/integrations/stripe/mcp-sync`,
        {}
      );
      setSyncResult(result);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="w-72 shrink-0 border-r flex flex-col overflow-y-auto">
      <div className="p-5 space-y-5">
        {/* Header */}
        <div>
          <h2 className="text-sm font-semibold capitalize">{type}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {integration
              ? "Update your configuration."
              : "Configure to start receiving events."}
          </p>
        </div>

        {/* Status */}
        {integration && (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Status</span>
              <span
                className={cn(
                  "font-medium",
                  integration.is_active ? "text-emerald-600" : "text-amber-500"
                )}
              >
                {integration.is_active ? "Active" : "Inactive"}
              </span>
            </div>
            <Separator />
          </>
        )}

        {/* Simulate toggle */}
        <div className="flex items-center justify-between">
          <Label className="text-xs cursor-pointer" htmlFor={`sim-${type}`}>
            Simulate
          </Label>
          <Switch
            id={`sim-${type}`}
            checked={isSimulating}
            onCheckedChange={onSimulateToggle}
          />
        </div>

        {!isSimulating && (
          <>
            <Separator />

            {/* Stripe: mode toggle */}
            {isStripe && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Ingestion mode</Label>
                  <div className="flex rounded-md border overflow-hidden text-xs">
                    {(["webhook", "mcp"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => { setMode(m); setError(""); setSyncResult(null); setSyncError(""); }}
                        className={cn(
                          "flex-1 py-1.5 font-medium transition-colors",
                          mode === m
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {m === "webhook" ? "Webhook" : "MCP Pull"}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {mode === "webhook"
                      ? "Stripe pushes events to your endpoint in real time."
                      : "Autopilot pulls failures from Stripe on a schedule."}
                  </p>
                </div>
                <Separator />
              </>
            )}

            {/* MCP Pull mode UI */}
            {isStripe && mode === "mcp" ? (
              <div className="space-y-4">
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="mcp-key" className="text-xs">
                      {integration?.config && (integration.config as Record<string, unknown>).mode === "mcp"
                        ? "Rotate API Key"
                        : "Stripe Secret Key"}
                    </Label>
                    <Input
                      id="mcp-key"
                      type="password"
                      required
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      placeholder="sk_live_…"
                      className="font-mono text-xs h-7"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Needs read access to PaymentIntents, Charges, Disputes, Invoices. Encrypted at rest.
                    </p>
                  </div>

                  {error && <p className="text-xs text-destructive">{error}</p>}

                  <Button type="submit" size="sm" disabled={submitting} className="w-full">
                    {submitting ? "Saving…" : integration ? "Rotate Key" : "Enable MCP Pull"}
                  </Button>
                </form>

                {/* Sync controls — only after integration is saved in MCP mode */}
                {integration && (integration.config as Record<string, unknown>)?.mode === "mcp" && (
                  <>
                    <Separator />
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Manual sync</Label>
                        {lastSync && (
                          <span className="text-[11px] text-muted-foreground">
                            Last: {timeAgo(lastSync)}
                          </span>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full gap-1.5"
                        disabled={syncing}
                        onClick={handleSync}
                      >
                        <IconRefresh className={cn("size-3.5", syncing && "animate-spin")} />
                        {syncing ? "Pulling…" : "Sync now"}
                      </Button>
                      {syncResult !== null && (
                        <p className="text-[11px] text-emerald-600">
                          {syncResult.pulled > 0
                            ? `Pulled ${syncResult.pulled} new event${syncResult.pulled !== 1 ? "s" : ""}`
                            : "Already up to date"}
                        </p>
                      )}
                      {syncError && (
                        <p className="text-[11px] text-destructive">{syncError}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground">
                        Auto-syncs every 5 minutes in the background.
                      </p>
                    </div>
                  </>
                )}
              </div>
            ) : (
              /* Webhook mode UI (default for all types) */
              <>
                {/* Webhook URL */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Endpoint URL</Label>
                  <div className="flex gap-1.5">
                    <Input
                      readOnly
                      value={webhookUrl}
                      className="font-mono text-[11px] h-7"
                    />
                    <Button type="button" variant="outline" size="icon-sm" onClick={copy}>
                      {copied ? (
                        <IconCheck className="size-3.5 text-emerald-600" />
                      ) : (
                        <IconCopy className="size-3.5" />
                      )}
                    </Button>
                  </div>
                </div>

                <Separator />

                {/* Secret form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor={`secret-${type}`} className="text-xs">
                      {integration ? "Rotate Secret" : "Webhook Secret"}
                    </Label>
                    <Input
                      id={`secret-${type}`}
                      type="password"
                      required
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      placeholder={
                        type === "stripe"
                          ? "whsec_…"
                          : type === "fullstory"
                          ? "shared-secret"
                          : "your-secret"
                      }
                      className="font-mono text-xs h-7"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Encrypted at rest. Never exposed after saving.
                    </p>
                  </div>

                  {error && <p className="text-xs text-destructive">{error}</p>}

                  <Button type="submit" size="sm" disabled={submitting} className="w-full">
                    {submitting
                      ? "Saving…"
                      : integration
                      ? "Rotate Secret"
                      : "Enable Integration"}
                  </Button>
                </form>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
