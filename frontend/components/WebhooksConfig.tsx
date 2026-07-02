"use client";

import { useState } from "react";
import {
  IconCheck,
  IconPlus,
  IconTrash,
  IconWebhook,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api";

export interface WebhookSubscription {
  id: string;
  project_id: string;
  url: string;
  event_types: string[];
  enabled: boolean;
  created_at: string;
  last_delivery_at: string | null;
  last_delivery_status: number | null;
  last_delivery_error: string | null;
  secret_preview: string;
}

interface WebhookSubscriptionCreated extends WebhookSubscription {
  secret: string;
}

const EVENT_LABELS: Record<string, string> = {
  "cluster.created": "Cluster created",
  "cluster.scored": "Cluster (re)scored",
  "cluster.issue_filed": "GitHub issue filed",
  "cluster.fix_requested": "Fix requested",
  "cluster.fix_pr_linked": "Fix PR linked",
  "cluster.resolved": "Cluster resolved",
};

function deliveryLabel(sub: WebhookSubscription): { text: string; className: string } {
  if (!sub.last_delivery_at) return { text: "Not delivered yet", className: "text-muted-foreground" };
  if (sub.last_delivery_error) return { text: `Failed: ${sub.last_delivery_error}`, className: "text-destructive" };
  if (sub.last_delivery_status && sub.last_delivery_status < 300)
    return { text: `Delivered (HTTP ${sub.last_delivery_status})`, className: "text-emerald-600" };
  return { text: `HTTP ${sub.last_delivery_status ?? "?"}`, className: "text-amber-600" };
}

function SubscriptionRow({
  slug,
  eventTypes,
  sub,
  onChanged,
  onDeleted,
}: {
  slug: string;
  eventTypes: string[];
  sub: WebhookSubscription;
  onChanged: (updated: WebhookSubscription) => void;
  onDeleted: (id: string) => void;
}) {
  const [toggling, setToggling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status_code: number | null; error: string | null } | null>(null);
  const [rotating, setRotating] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const api = apiClient();

  const handleToggle = async (enabled: boolean) => {
    setToggling(true);
    try {
      const updated = await api.patch<WebhookSubscription>(
        `/api/projects/${slug}/webhook-subscriptions/${sub.id}`,
        { enabled }
      );
      onChanged(updated);
    } catch {
      // revert quietly
    } finally {
      setToggling(false);
    }
  };

  const handleEventToggle = async (eventType: string, checked: boolean) => {
    const next = checked
      ? [...sub.event_types.filter((e) => e !== "*"), eventType]
      : sub.event_types.filter((e) => e !== eventType);
    if (next.length === 0) return;
    try {
      const updated = await api.patch<WebhookSubscription>(
        `/api/projects/${slug}/webhook-subscriptions/${sub.id}`,
        { event_types: next }
      );
      onChanged(updated);
    } catch {
      // ignore — row keeps previous state
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.post<{ status_code: number | null; error: string | null }>(
        `/api/projects/${slug}/webhook-subscriptions/${sub.id}/test`,
        {}
      );
      setTestResult(result);
    } catch (err) {
      setTestResult({ status_code: null, error: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleRotateSecret = async () => {
    setRotating(true);
    try {
      const updated = await api.patch<WebhookSubscriptionCreated>(
        `/api/projects/${slug}/webhook-subscriptions/${sub.id}`,
        { regenerate_secret: true }
      );
      setNewSecret(updated.secret);
      onChanged(updated);
    } finally {
      setRotating(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.del(`/api/projects/${slug}/webhook-subscriptions/${sub.id}`);
      onDeleted(sub.id);
    } catch {
      setDeleting(false);
    }
  };

  const delivery = deliveryLabel(sub);

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-mono truncate">{sub.url}</p>
          <p className={`text-[11px] mt-0.5 ${delivery.className}`}>{delivery.text}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Switch checked={sub.enabled} onCheckedChange={handleToggle} disabled={toggling} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
            disabled={deleting}
            title="Delete webhook"
          >
            <IconTrash className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {eventTypes.map((et) => (
          <label key={et} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              className="accent-foreground"
              checked={sub.event_types.includes("*") || sub.event_types.includes(et)}
              onChange={(e) => handleEventToggle(et, e.target.checked)}
            />
            <span className="text-[11px]">{EVENT_LABELS[et] ?? et}</span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3 text-[11px]">
        <span className="text-muted-foreground font-mono">secret {sub.secret_preview}</span>
        <button
          type="button"
          onClick={handleRotateSecret}
          disabled={rotating}
          className="text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          {rotating ? "Rotating…" : "Rotate secret"}
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          {testing ? "Sending…" : "Send test event"}
        </button>
      </div>

      {testResult && (
        <p className={`text-[11px] ${testResult.error ? "text-destructive" : "text-emerald-600"}`}>
          {testResult.error ? `Test failed: ${testResult.error}` : `Test delivered — HTTP ${testResult.status_code}`}
        </p>
      )}

      {newSecret && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 px-3 py-2 space-y-1">
          <p className="text-[11px] font-medium text-amber-800 dark:text-amber-400">
            New secret — shown once, copy it now:
          </p>
          <code className="text-[11px] break-all">{newSecret}</code>
        </div>
      )}
    </div>
  );
}

function AddWebhookForm({
  slug,
  eventTypes,
  onCreated,
}: {
  slug: string;
  eventTypes: string[];
  onCreated: (created: WebhookSubscriptionCreated) => void;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<WebhookSubscriptionCreated | null>(null);
  const api = apiClient();

  const toggleEvent = (et: string) => {
    setSelected((prev) => (prev.includes(et) ? prev.filter((e) => e !== et) : [...prev, et]));
  };

  const handleCreate = async () => {
    setSaving(true);
    setError("");
    try {
      const result = await api.post<WebhookSubscriptionCreated>(
        `/api/projects/${slug}/webhook-subscriptions`,
        { url, event_types: selected, enabled: true }
      );
      setCreated(result);
      onCreated(result);
      setUrl("");
      setSelected([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add webhook");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => { setOpen(true); setCreated(null); }} className="gap-1.5">
        <IconPlus className="size-3.5" />
        Add webhook
      </Button>
    );
  }

  return (
    <div className="rounded-md border border-dashed p-3 space-y-3">
      <p className="text-xs font-medium">Add an outbound webhook</p>

      {created ? (
        <div className="space-y-2">
          <p className="text-[11px] text-emerald-600">Webhook created.</p>
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 px-3 py-2 space-y-1">
            <p className="text-[11px] font-medium text-amber-800 dark:text-amber-400">
              Signing secret — shown once, copy it now:
            </p>
            <code className="text-[11px] break-all">{created.secret}</code>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">URL</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-app.example.com/autopilot-webhook"
              className="h-8 text-xs font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Events</Label>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {eventTypes.map((et) => (
                <label key={et} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-foreground"
                    checked={selected.includes(et)}
                    onChange={() => toggleEvent(et)}
                  />
                  <span className="text-[11px]">{EVENT_LABELS[et] ?? et}</span>
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-[11px] text-destructive">{error}</p>}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleCreate}
              disabled={saving || !url.trim() || selected.length === 0}
            >
              {saving ? "Adding…" : "Add webhook"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export default function WebhooksConfig({
  slug,
  initialSubscriptions,
  initialEventTypes,
}: {
  slug: string;
  initialSubscriptions: WebhookSubscription[];
  initialEventTypes: string[];
}) {
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);

  const handleChanged = (updated: WebhookSubscription) => {
    setSubscriptions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  };
  const handleCreated = (created: WebhookSubscriptionCreated) => {
    setSubscriptions((prev) => [...prev, created]);
  };
  const handleDeleted = (id: string) => {
    setSubscriptions((prev) => prev.filter((s) => s.id !== id));
  };

  const anyEnabled = subscriptions.some((s) => s.enabled);

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <IconWebhook className="size-6" />
        <div>
          <h2 className="text-sm font-semibold">Webhooks</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            React to pipeline stages (cluster created, scored, issue filed, fix requested,
            fix PR linked, resolved) without polling — build a Slack notifier, a custom
            dashboard, or anything else on top of Autopilot.
          </p>
        </div>
      </div>

      {anyEnabled ? (
        <div className="flex items-center gap-1.5 text-xs text-emerald-600">
          <IconCheck className="size-3.5" />
          {subscriptions.filter((s) => s.enabled).length} webhook{subscriptions.filter((s) => s.enabled).length === 1 ? "" : "s"} active
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No webhooks configured yet.</p>
      )}

      <Separator />

      <div className="space-y-3">
        {subscriptions.map((s) => (
          <SubscriptionRow
            key={s.id}
            slug={slug}
            eventTypes={initialEventTypes}
            sub={s}
            onChanged={handleChanged}
            onDeleted={handleDeleted}
          />
        ))}
      </div>

      <AddWebhookForm slug={slug} eventTypes={initialEventTypes} onCreated={handleCreated} />

      <Separator />

      <div className="text-[11px] text-muted-foreground space-y-1">
        <p>
          Every delivery includes an <span className="font-mono">X-Autopilot-Signature: sha256=…</span> header —
          an HMAC-SHA256 of the raw request body using your webhook&apos;s secret. Verify it before trusting the payload.
        </p>
        <p>See the README&apos;s Webhooks section for a signature-verification code example.</p>
      </div>
    </div>
  );
}
