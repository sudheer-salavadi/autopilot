"use client";

import { useState } from "react";
import { IconRefresh } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { apiClient } from "@/lib/api";
import type { Integration, Project } from "@/components/IntegrationsPanel";
import ScoutsConfig from "@/components/ScoutsConfig";

type AuthType = "none" | "bearer" | "header";
type PollingInterval = 300 | 900 | 3600;

interface Tool {
  name: string;
  description: string;
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

export default function McpServerConfig({
  project,
  integration,
  onSaved,
}: {
  project: Project;
  integration?: Integration;
  onSaved: (updated: Integration) => void;
}) {
  const cfg = (integration?.config ?? {}) as Record<string, unknown>;

  const [serverUrl, setServerUrl] = useState((cfg.server_url as string) ?? "");
  const [authType, setAuthType] = useState<AuthType>((cfg.auth_type as AuthType) ?? "none");
  const [authValue, setAuthValue] = useState("");
  const [authHeaderName, setAuthHeaderName] = useState((cfg.auth_header_name as string) ?? "");
  const [pollingInterval, setPollingInterval] = useState<PollingInterval>(
    (cfg.polling_interval_seconds as PollingInterval) ?? 300
  );
  const [selectedTools, setSelectedTools] = useState<string[]>(
    (cfg.selected_tools as string[]) ?? []
  );

  const [tools, setTools] = useState<Tool[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ pulled: number } | null>(null);
  const [syncError, setSyncError] = useState("");

  const lastSync = cfg.last_mcp_sync as string | undefined;
  const configuredToolCount = (cfg.selected_tools as string[] | undefined)?.length ?? 0;
  const api = apiClient();

  const handleDiscover = async () => {
    if (!serverUrl) return;
    setDiscovering(true);
    setDiscoverError("");
    setTools(null);
    try {
      const result = await api.post<{ tools: Tool[] }>(
        `/api/projects/${project.slug}/integrations/mcp/discover`,
        {
          server_url: serverUrl,
          auth_type: authType,
          ...(authType !== "none" && authValue ? { auth_value: authValue } : {}),
          ...(authType === "header" ? { auth_header_name: authHeaderName } : {}),
        }
      );
      setTools(result.tools);
      if (!integration && result.tools.length > 0) {
        setSelectedTools(result.tools.map((t) => t.name));
      }
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : "Failed to connect to server");
    } finally {
      setDiscovering(false);
    }
  };

  const toggleTool = (name: string) => {
    setSelectedTools((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError("");
    setSubmitting(true);
    try {
      const config = {
        server_url: serverUrl,
        auth_type: authType,
        ...(authType === "header" ? { auth_header_name: authHeaderName } : {}),
        selected_tools: selectedTools,
        polling_interval_seconds: pollingInterval,
        ...(cfg.last_mcp_sync ? { last_mcp_sync: cfg.last_mcp_sync } : {}),
      };

      let result: Integration;
      if (integration) {
        const payload: Record<string, unknown> = { config, is_active: true };
        if (authValue) payload.webhook_secret = authValue;
        result = await api.put<Integration>(
          `/api/projects/${project.slug}/integrations/${integration.id}`,
          payload
        );
      } else {
        result = await api.post<Integration>(
          `/api/projects/${project.slug}/integrations`,
          {
            type: "mcp_server",
            webhook_secret: authType !== "none" ? authValue : "",
            config,
          }
        );
      }
      setAuthValue("");
      onSaved(result);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSync = async () => {
    if (!integration) return;
    setSyncing(true);
    setSyncError("");
    setSyncResult(null);
    try {
      const result = await api.post<{ pulled: number }>(
        `/api/projects/${project.slug}/integrations/${integration.id}/mcp-sync`,
        {}
      );
      setSyncResult(result);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const canSave =
    serverUrl.length > 0 &&
    selectedTools.length > 0 &&
    (authType === "none" || !!authValue || !!integration);

  return (
    <div className="w-72 shrink-0 border-r flex flex-col overflow-y-auto">
      <div className="p-5 space-y-5">
        {/* Header */}
        <div>
          <h2 className="text-sm font-semibold">MCP Server</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {integration
              ? "Update your MCP server configuration."
              : "Connect any MCP-compatible server to pull events on a schedule."}
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

        {/* Server URL */}
        <div className="space-y-1.5">
          <Label htmlFor="mcp-url" className="text-xs">
            Server URL
          </Label>
          <Input
            id="mcp-url"
            type="url"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://mcp.example.com"
            className="font-mono text-xs h-7"
          />
        </div>

        {/* Auth type */}
        <div className="space-y-1.5">
          <Label className="text-xs">Authentication</Label>
          <div className="flex rounded-md border overflow-hidden text-xs">
            {(["none", "bearer", "header"] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => {
                  setAuthType(a);
                  setAuthValue("");
                }}
                className={cn(
                  "flex-1 py-1.5 font-medium transition-colors",
                  authType === a
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {a === "none" ? "None" : a === "bearer" ? "Bearer" : "Header"}
              </button>
            ))}
          </div>
        </div>

        {authType !== "none" && (
          <>
            {authType === "header" && (
              <div className="space-y-1.5">
                <Label htmlFor="mcp-header-name" className="text-xs">
                  Header name
                </Label>
                <Input
                  id="mcp-header-name"
                  value={authHeaderName}
                  onChange={(e) => setAuthHeaderName(e.target.value)}
                  placeholder="X-Api-Key"
                  className="font-mono text-xs h-7"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="mcp-auth-value" className="text-xs">
                {integration
                  ? "Rotate auth value"
                  : authType === "bearer"
                  ? "Bearer token"
                  : "Header value"}
              </Label>
              <Input
                id="mcp-auth-value"
                type="password"
                value={authValue}
                onChange={(e) => setAuthValue(e.target.value)}
                placeholder={integration ? "Leave blank to keep current" : "your-token"}
                className="font-mono text-xs h-7"
              />
              <p className="text-[11px] text-muted-foreground">
                Encrypted at rest. Never exposed after saving.
              </p>
            </div>
          </>
        )}

        {/* Discover tools */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          disabled={!serverUrl || discovering}
          onClick={handleDiscover}
        >
          <IconRefresh className={cn("size-3.5", discovering && "animate-spin")} />
          {discovering ? "Connecting…" : "Discover tools"}
        </Button>

        {discoverError && <p className="text-xs text-destructive">{discoverError}</p>}

        {/* Tool checklist */}
        {tools !== null ? (
          tools.length > 0 ? (
            <div className="space-y-1.5">
              <Label className="text-xs">
                Tools ({selectedTools.length}/{tools.length} selected)
              </Label>
              <div className="space-y-1.5 max-h-44 overflow-y-auto">
                {tools.map((tool) => (
                  <label key={tool.name} className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-foreground"
                      checked={selectedTools.includes(tool.name)}
                      onChange={() => toggleTool(tool.name)}
                    />
                    <span className="text-xs">
                      <span className="font-medium font-mono">{tool.name}</span>
                      {tool.description && (
                        <span className="text-muted-foreground"> — {tool.description}</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No tools found on this server.</p>
          )
        ) : integration && configuredToolCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            {configuredToolCount} tool{configuredToolCount !== 1 ? "s" : ""} configured.{" "}
            Click <span className="text-foreground font-medium">Discover tools</span> to edit
            selection.
          </p>
        ) : null}

        {/* Polling interval */}
        <div className="space-y-1.5">
          <Label className="text-xs">Sync interval</Label>
          <div className="flex rounded-md border overflow-hidden text-xs">
            {(
              [
                { value: 300, label: "5 min" },
                { value: 900, label: "15 min" },
                { value: 3600, label: "1 hour" },
              ] as { value: PollingInterval; label: string }[]
            ).map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setPollingInterval(value)}
                className={cn(
                  "flex-1 py-1.5 font-medium transition-colors",
                  pollingInterval === value
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {saveError && <p className="text-xs text-destructive">{saveError}</p>}

        <Button
          onClick={handleSave}
          size="sm"
          disabled={submitting || !canSave}
          className="w-full"
        >
          {submitting ? "Saving…" : integration ? "Update" : "Save & Enable"}
        </Button>

        {/* Manual sync */}
        {integration && (
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
              {syncError && <p className="text-[11px] text-destructive">{syncError}</p>}
              <p className="text-[11px] text-muted-foreground">
                Auto-syncs in the background per your selected interval.
              </p>
            </div>

            <Separator />

            <ScoutsConfig
              slug={project.slug}
              integrationId={integration.id}
              availableTools={tools}
            />
          </>
        )}
      </div>
    </div>
  );
}
