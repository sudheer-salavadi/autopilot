"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import {
  IconBrandGithub,
  IconCheck,
  IconCircleFilled,
  IconExternalLink,
  IconLoader2,
  IconRefresh,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiClient } from "@/lib/api";

export interface GithubConfig {
  project_id: string;
  repo: string | null;
  installation_id: number | null;
  is_installed: boolean;
  autopilot_enabled: boolean;
  autopilot_min_score: number;
}

interface Repo {
  full_name: string;
  private: boolean;
}

export default function GitHubConfig({
  slug,
  initialConfig,
  appSlug,
  onConfigSaved,
}: {
  slug: string;
  initialConfig: GithubConfig;
  appSlug: string;
  onConfigSaved?: (config: GithubConfig) => void;
}) {
  const searchParams = useSearchParams();
  const [config, setConfig] = useState(initialConfig);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState(initialConfig.repo ?? "");
  const [saving, setSaving] = useState(false);
  const [showManualId, setShowManualId] = useState(false);
  const [manualId, setManualId] = useState("");
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [connectedFlash, setConnectedFlash] = useState(false);

  const api = apiClient();

  // Flash "GitHub App connected" when redirected back from callback
  useEffect(() => {
    if (searchParams.get("github") === "connected") {
      setConnectedFlash(true);
      setTimeout(() => setConnectedFlash(false), 5000);
      posthog.capture("github_app_installed", {
        project_slug: slug,
      });
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch accessible repos whenever the app is installed
  const fetchRepos = async () => {
    if (!config.is_installed) return;
    setReposLoading(true);
    setError("");
    try {
      const data = await api.get<Repo[]>(`/api/projects/${slug}/github-config/repos`);
      setRepos(data);
    } catch (err) {
      setRepos([]);
      setError(err instanceof Error ? err.message : "Failed to load repositories.");
    } finally {
      setReposLoading(false);
    }
  };

  useEffect(() => {
    fetchRepos();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.is_installed]);

  const installUrl = appSlug
    ? `https://github.com/apps/${appSlug}/installations/new?state=${slug}`
    : "#";

  const handleManualInstall = async () => {
    const id = parseInt(manualId.trim(), 10);
    if (!id) { setManualError("Enter a valid numeric installation ID."); return; }
    setManualSaving(true);
    setManualError("");
    try {
      const updated = await api.put<GithubConfig>(
        `/api/projects/${slug}/github-config`,
        { installation_id: id }
      );
      setConfig(updated);
      setShowManualId(false);
      setManualId("");
    } catch (err) {
      setManualError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setManualSaving(false);
    }
  };

  const handleSaveRepo = async () => {
    setError("");
    setSaving(true);
    try {
      const updated = await api.put<GithubConfig>(
        `/api/projects/${slug}/github-config`,
        { repo: selectedRepo }
      );
      setConfig(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      onConfigSaved?.(updated);
      posthog.capture("github_repo_saved", {
        project_slug: slug,
        repo: selectedRepo,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      posthog.captureException(err);
    } finally {
      setSaving(false);
    }
  };

  const handleAutopilotToggle = async (enabled: boolean) => {
    setConfig((c) => ({ ...c, autopilot_enabled: enabled }));
    posthog.capture("github_autopilot_toggled", {
      project_slug: slug,
      autopilot_enabled: enabled,
    });
    try {
      const updated = await api.put<GithubConfig>(
        `/api/projects/${slug}/github-config`,
        { autopilot_enabled: enabled }
      );
      setConfig(updated);
      onConfigSaved?.(updated);
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
      posthog.capture("github_connection_verified", {
        project_slug: slug,
        result_ok: result.ok,
        result_message: result.message,
      });
    } catch (err) {
      setVerifyResult({
        ok: false,
        message: err instanceof Error ? err.message : "Verification failed",
      });
      posthog.captureException(err);
    } finally {
      setVerifying(false);
    }
  };

  const isConnected = config.is_installed && !!config.repo;

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
            className={`size-2 ${isConnected ? "text-emerald-500" : "text-muted-foreground/40"}`}
          />
          <span className="text-xs text-muted-foreground">
            {isConnected ? `Connected to ${config.repo}` : config.is_installed ? "Select repo" : "Not installed"}
          </span>
        </div>
      </div>

      {connectedFlash && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900 px-3 py-2">
          <IconCheck className="size-3.5 text-emerald-600 shrink-0" />
          <p className="text-xs text-emerald-700 dark:text-emerald-400">
            GitHub App connected successfully.
          </p>
        </div>
      )}

      <Separator />

      {/* Install section */}
      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium">GitHub App Installation</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Install the Autopilot GitHub App to grant fine-grained access to your
            repositories. Tokens auto-refresh — no manual rotation needed.
          </p>
        </div>

        <a
          href={installUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!appSlug}
            asChild
          >
            <span>
              <IconBrandGithub className="size-3.5" />
              {config.is_installed ? "Reinstall / change org" : "Install GitHub App"}
              <IconExternalLink className="size-3 ml-0.5 text-muted-foreground" />
            </span>
          </Button>
        </a>

        {!appSlug && (
          <p className="text-[11px] text-amber-600">
            NEXT_PUBLIC_GITHUB_APP_SLUG is not set. Configure the env var to enable this button.
          </p>
        )}

        {/* Manual installation ID fallback */}
        {!config.is_installed && (
          <div>
            <button
              type="button"
              onClick={() => setShowManualId((v) => !v)}
              className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
            >
              {showManualId ? "Hide" : "Didn't get redirected back? Enter installation ID manually"}
            </button>
            {showManualId && (
              <div className="mt-2 space-y-2">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Find your installation ID at{" "}
                  <span className="font-mono">github.com/settings/installations</span>
                  {" "}— it's the number in the URL of your installed app.
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    value={manualId}
                    onChange={(e) => { setManualId(e.target.value); setManualError(""); }}
                    placeholder="e.g. 12345678"
                    className="h-8 text-xs font-mono w-40"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleManualInstall}
                    disabled={manualSaving || !manualId.trim()}
                  >
                    {manualSaving ? "Saving…" : "Save"}
                  </Button>
                </div>
                {manualError && <p className="text-[11px] text-destructive">{manualError}</p>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Repo selector — only shown when installed */}
      {config.is_installed && (
        <>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Repository</Label>
              <button
                type="button"
                onClick={fetchRepos}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                disabled={reposLoading}
              >
                <IconRefresh className={`size-3 ${reposLoading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>

            {reposLoading ? (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <IconLoader2 className="size-3.5 animate-spin" />
                Loading repositories…
              </div>
            ) : (
              <Select value={selectedRepo} onValueChange={setSelectedRepo}>
                <SelectTrigger className="h-8 text-xs font-mono">
                  <SelectValue placeholder="Select a repository…" />
                </SelectTrigger>
                <SelectContent>
                  {repos.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground">
                      No repositories found. Check your installation permissions.
                    </div>
                  ) : (
                    repos.map((r) => (
                      <SelectItem key={r.full_name} value={r.full_name} className="text-xs font-mono">
                        {r.full_name}
                        {r.private && (
                          <span className="ml-2 text-[10px] text-muted-foreground">private</span>
                        )}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                onClick={handleSaveRepo}
                disabled={saving || !selectedRepo}
              >
                {saving ? "Saving…" : saved ? <><IconCheck className="size-3.5 mr-1" />Saved</> : "Save"}
              </Button>
              {isConnected && (
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
              <p className={`text-xs ${verifyResult.ok ? "text-emerald-600" : "text-destructive"}`}>
                {verifyResult.ok ? "✓ " : "✗ "}
                {verifyResult.message}
              </p>
            )}
          </div>
        </>
      )}

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
            disabled={!isConnected}
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

        {!isConnected && (
          <p className="text-[11px] text-muted-foreground">
            Install the GitHub App and select a repository above to enable Autopilot.
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
        <p>
          The GitHub App uses fine-grained permissions (Issues: Read &amp; Write) and
          auto-refreshing installation tokens — no personal access tokens needed.
        </p>
      </div>
    </div>
  );
}
