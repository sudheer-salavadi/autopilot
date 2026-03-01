"use client";

import { useState } from "react";
import { IconBrandGithub, IconCheck, IconCircleFilled, IconCopy, IconExternalLink } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api";

export interface GithubConfig {
  project_id: string;
  repo: string | null;
  has_token: boolean;
  has_webhook_secret: boolean;
  autopilot_enabled: boolean;
  autopilot_min_score: number;
}

export default function GitHubConfig({
  slug,
  initialConfig,
  onConfigSaved,
}: {
  slug: string;
  initialConfig: GithubConfig;
  onConfigSaved?: (config: GithubConfig) => void;
}) {
  const [config, setConfig] = useState(initialConfig);
  const [repo, setRepo] = useState(initialConfig.repo ?? "");
  const [token, setToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const api = apiClient();

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const body: Record<string, unknown> = { repo };
      if (token) body.token = token;
      if (webhookSecret) body.webhook_secret = webhookSecret;
      const updated = await api.put<GithubConfig>(
        `/api/projects/${slug}/github-config`,
        body
      );
      setConfig(updated);
      setToken("");
      setWebhookSecret("");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      onConfigSaved?.(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleAutopilotToggle = async (enabled: boolean) => {
    setConfig((c) => ({ ...c, autopilot_enabled: enabled }));
    try {
      await api.put(`/api/projects/${slug}/github-config`, {
        autopilot_enabled: enabled,
      });
    } catch {
      setConfig((c) => ({ ...c, autopilot_enabled: !enabled }));
    }
  };

  const handleMinScoreChange = async (value: number) => {
    setConfig((c) => ({ ...c, autopilot_min_score: value }));
    try {
      await api.put(`/api/projects/${slug}/github-config`, {
        autopilot_min_score: value,
      });
    } catch {
      // revert quietly
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const result = await api.post<{ ok: boolean; message: string }>(
        `/api/projects/${slug}/github-config/verify`,
        {}
      );
      setVerifyResult(result);
    } catch (err) {
      setVerifyResult({
        ok: false,
        message: err instanceof Error ? err.message : "Verification failed",
      });
    } finally {
      setVerifying(false);
    }
  };

  const isConfigured = config.has_token && !!config.repo;
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const webhookUrl = `${API_URL}/api/webhooks/${config.project_id}/github`;

  const [copiedWebhook, setCopiedWebhook] = useState(false);
  function copyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  }

  return (
    <div className="max-w-lg space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <IconBrandGithub className="size-6" />
        <div>
          <h2 className="text-sm font-semibold">GitHub Integration</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            File GitHub issues directly from Autopilot. One repo per project.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <IconCircleFilled
            className={`size-2 ${isConfigured ? "text-emerald-500" : "text-muted-foreground/40"}`}
          />
          <span className="text-xs text-muted-foreground">
            {isConfigured ? "Connected" : "Not configured"}
          </span>
        </div>
      </div>

      <Separator />

      {/* Connection form */}
      <form onSubmit={handleSave} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="gh-repo" className="text-xs">
            Repository
          </Label>
          <Input
            id="gh-repo"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repo"
            className="font-mono text-xs h-8"
          />
          <p className="text-[11px] text-muted-foreground">
            e.g. <span className="font-mono">acme/backend</span>
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="gh-token" className="text-xs">
            {config.has_token ? "Rotate Token" : "Personal Access Token"}
          </Label>
          <Input
            id="gh-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={config.has_token ? "Leave blank to keep existing" : "ghp_…"}
            className="font-mono text-xs h-8"
          />
          <p className="text-[11px] text-muted-foreground">
            Needs <span className="font-mono">repo</span> scope (or{" "}
            <span className="font-mono">public_repo</span> for public repos).
            Encrypted at rest, never exposed.
          </p>
        </div>

        {/* Webhook URL */}
        <div className="space-y-1.5">
          <Label className="text-xs">Webhook URL</Label>
          <div className="flex gap-1.5">
            <Input
              readOnly
              value={config.project_id ? webhookUrl : "Save repo & token first"}
              className="font-mono text-[11px] h-8"
            />
            {config.project_id && (
              <Button type="button" variant="outline" size="icon-sm" onClick={copyWebhookUrl}>
                {copiedWebhook ? (
                  <IconCheck className="size-3.5 text-emerald-600" />
                ) : (
                  <IconCopy className="size-3.5" />
                )}
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Paste this URL into your GitHub repo → Settings → Webhooks.
            Select the <span className="font-mono">Issues</span> event.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="gh-webhook-secret" className="text-xs">
            {config.has_webhook_secret ? "Rotate Webhook Secret" : "Webhook Secret"}
          </Label>
          <Input
            id="gh-webhook-secret"
            type="password"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder={config.has_webhook_secret ? "Leave blank to keep existing" : "Set a secret in GitHub, paste it here"}
            className="font-mono text-xs h-8"
          />
          <p className="text-[11px] text-muted-foreground">
            Used to verify GitHub webhook signatures. Set the same value in GitHub webhook settings.
          </p>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving…" : saved ? <><IconCheck className="size-3.5 mr-1" />Saved</> : "Save"}
          </Button>
          {isConfigured && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleVerify}
              disabled={verifying}
            >
              {verifying ? "Verifying…" : "Test connection"}
            </Button>
          )}
        </div>

        {verifyResult && (
          <p
            className={`text-xs ${verifyResult.ok ? "text-emerald-600" : "text-destructive"}`}
          >
            {verifyResult.ok ? "✓ " : "✗ "}
            {verifyResult.message}
          </p>
        )}
      </form>

      <Separator />

      {/* Autopilot */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium">Autopilot Mode</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Automatically file GitHub issues when an issue exceeds the priority
            threshold. Regressions reopen the original issue.
          </p>
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-xs cursor-pointer" htmlFor="autopilot-toggle">
            Auto-file issues
          </Label>
          <Switch
            id="autopilot-toggle"
            checked={config.autopilot_enabled}
            onCheckedChange={handleAutopilotToggle}
            disabled={!isConfigured}
          />
        </div>

        {config.autopilot_enabled && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Min severity score</Label>
              <span className="text-xs font-mono text-muted-foreground">
                {(config.autopilot_min_score * 10).toFixed(1)} / 10
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={config.autopilot_min_score}
              onChange={(e) => handleMinScoreChange(parseFloat(e.target.value))}
              onMouseUp={(e) =>
                handleMinScoreChange(parseFloat((e.target as HTMLInputElement).value))
              }
              className="w-full accent-foreground"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0 — all issues</span>
              <span>10 — critical only</span>
            </div>
          </div>
        )}

        {!isConfigured && (
          <p className="text-[11px] text-muted-foreground">
            Configure repo and token above to enable Autopilot.
          </p>
        )}
      </div>

      <Separator />

      <div className="text-[11px] text-muted-foreground space-y-1">
        <p>
          Issues are filed with the <span className="font-mono">autopilot</span> label and
          include: root cause, signal breakdown, affected users, severity score, and a link
          back to this dashboard.
        </p>
        <a
          href="https://github.com/settings/tokens/new?scopes=repo"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-foreground/60 hover:text-foreground transition-colors"
        >
          Create a token on GitHub <IconExternalLink className="size-3" />
        </a>
      </div>
    </div>
  );
}
