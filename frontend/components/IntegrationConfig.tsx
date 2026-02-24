"use client";

import { useEffect, useRef, useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api";
import type { Integration, Project } from "@/components/IntegrationsPanel";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const SIMULATE_DELAY_MS = 1_000; // pause between generations

interface Props {
  project: Project;
  type: string;
  integration?: Integration;
  isSimulating: boolean;
  onSaved: (updated: Integration) => void;
  onSimulateToggle: (active: boolean) => void;
}

export default function IntegrationConfig({
  project,
  type,
  integration,
  isSimulating,
  onSaved,
  onSimulateToggle,
}: Props) {
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const runningRef = useRef(false);
  const api = apiClient();

  const webhookUrl = `${API_URL}/api/webhooks/${project.id}/${type}`;

  const copy = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Start/stop the generation loop based on isSimulating.
  // Uses an async loop instead of setInterval so the next request only
  // fires after the previous one completes — no queuing.
  useEffect(() => {
    if (!isSimulating) {
      runningRef.current = false;
      return;
    }

    runningRef.current = true;

    const loop = async () => {
      while (runningRef.current) {
        await api
          .post(`/api/projects/${project.slug}/demo-ingest`, { source: type })
          .catch(() => {});
        if (!runningRef.current) break;
        await new Promise((res) => setTimeout(res, SIMULATE_DELAY_MS));
      }
    };

    loop();

    return () => {
      runningRef.current = false;
    };
  }, [isSimulating]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      let result: Integration;
      if (integration) {
        result = await api.put<Integration>(
          `/api/projects/${project.slug}/integrations/${integration.id}`,
          { webhook_secret: secret }
        );
      } else {
        result = await api.post<Integration>(
          `/api/projects/${project.slug}/integrations`,
          { type, webhook_secret: secret }
        );
      }
      setSecret("");
      onSaved(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
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
              ? "Update your webhook configuration."
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

        <Separator />

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
      </div>
    </div>
  );
}
