"use client";

import { useState } from "react";
import { IconBrandGithub, IconCheck, IconCircleFilled, IconExternalLink } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api";

interface GithubConfig {
  project_id: string;
  repo: string | null;
  has_token: boolean;
  autopilot_enabled: boolean;
  autopilot_min_score: number;
}

export default function GitHubConfig({
  slug,
  initialConfig,
}: {
  slug: string;
  initialConfig: GithubConfig;
}) {
  const [config, setConfig] = useState(initialConfig);
  const [repo, setRepo] = useState(initialConfig.repo ?? "");
  const [token, setToken] = useState("");
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
      const updated = await api.put<GithubConfig>(
        `/api/projects/${slug}/github-config`,
        body
      );
      setConfig(updated);
      setToken("");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
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

  return (
    <div className="max-w-lg space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <IconBrandGithub className="size-6" />
        <div>
          <h2 className="text-sm font-semibold">GitHub Integration</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            File issues directly from clusters. One repo per project.
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
            Automatically file GitHub issues when a cluster exceeds the priority
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
              <Label className="text-xs">Min priority score</Label>
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
              <span>0 — all clusters</span>
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
          include: root cause, signal breakdown, affected users, priority score, and a link
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
