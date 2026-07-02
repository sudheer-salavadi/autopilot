"use client";

import { useState } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconExternalLink,
  IconRobot,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api";

export interface AgentProvider {
  provider: string;
  name: string;
  enabled: boolean;
  trigger_template: string;
  is_custom_template: boolean;
  setup_docs_url: string;
}

function ProviderRow({
  slug,
  provider,
  githubConnected,
  onChanged,
}: {
  slug: string;
  provider: AgentProvider;
  githubConnected: boolean;
  onChanged: (updated: AgentProvider) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draftTemplate, setDraftTemplate] = useState(provider.trigger_template);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [toggling, setToggling] = useState(false);
  const api = apiClient();

  const handleToggle = async (enabled: boolean) => {
    setToggling(true);
    try {
      const updated = await api.put<AgentProvider>(
        `/api/projects/${slug}/agent-config/${provider.provider}`,
        { enabled }
      );
      onChanged(updated);
    } catch {
      // revert quietly — provider prop is unchanged since parent re-renders from server state
    } finally {
      setToggling(false);
    }
  };

  const handleSaveTemplate = async () => {
    setSavingTemplate(true);
    try {
      const updated = await api.put<AgentProvider>(
        `/api/projects/${slug}/agent-config/${provider.provider}`,
        { trigger_template: draftTemplate }
      );
      onChanged(updated);
    } catch {
      // keep draft so the user doesn't lose their edit
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleResetTemplate = async () => {
    setSavingTemplate(true);
    try {
      const updated = await api.put<AgentProvider>(
        `/api/projects/${slug}/agent-config/${provider.provider}`,
        { reset_template: true }
      );
      setDraftTemplate(updated.trigger_template);
      onChanged(updated);
    } finally {
      setSavingTemplate(false);
    }
  };

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{provider.name}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {provider.enabled
              ? "Enabled — the trigger comment below is posted when you click \"Fix with " +
                provider.name + "\" on an issue."
              : "Disabled — won't appear in the \"Fix with…\" menu on issues."}
          </p>
        </div>
        <Switch
          checked={provider.enabled}
          onCheckedChange={handleToggle}
          disabled={toggling}
        />
      </div>

      <div className="flex items-center gap-3 text-[11px]">
        <a
          href={provider.setup_docs_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          Setup guide for {provider.name}
          <IconExternalLink className="size-3" />
        </a>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? "Hide" : "Customize"} trigger comment
          {expanded ? <IconChevronUp className="size-3" /> : <IconChevronDown className="size-3" />}
        </button>
      </div>

      {!githubConnected && (
        <p className="text-[11px] text-amber-600">
          Connect GitHub above — a fix can only be triggered on an issue that's already filed.
        </p>
      )}

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Autopilot doesn&apos;t verify {provider.name} is actually installed on your repo — it
        just posts this comment on the filed issue. If nothing happens after triggering, check
        that {provider.name}&apos;s GitHub App/Action is installed (see setup guide) and that its
        trigger phrase matches what&apos;s below.
      </p>

      {expanded && (
        <div className="space-y-2 pt-1">
          <Textarea
            value={draftTemplate}
            onChange={(e) => setDraftTemplate(e.target.value)}
            className="text-xs font-mono min-h-20"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleSaveTemplate}
              disabled={savingTemplate || draftTemplate === provider.trigger_template}
            >
              {savingTemplate ? "Saving…" : "Save"}
            </Button>
            {provider.is_custom_template && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleResetTemplate}
                disabled={savingTemplate}
              >
                Reset to default
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CodingAgentsConfig({
  slug,
  initialProviders,
  githubConnected,
}: {
  slug: string;
  initialProviders: AgentProvider[];
  githubConnected: boolean;
}) {
  const [providers, setProviders] = useState(initialProviders);

  const handleChanged = (updated: AgentProvider) => {
    setProviders((prev) => prev.map((p) => (p.provider === updated.provider ? updated : p)));
  };

  const anyEnabled = providers.some((p) => p.enabled);

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <IconRobot className="size-6" />
        <div>
          <h2 className="text-sm font-semibold">Coding Agents</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Trigger a fix on a filed GitHub issue from Autopilot — one click, no context switch.
          </p>
        </div>
      </div>

      {anyEnabled ? (
        <div className="flex items-center gap-1.5 text-xs text-emerald-600">
          <IconCheck className="size-3.5" />
          {providers.filter((p) => p.enabled).map((p) => p.name).join(", ")} available on issues
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No coding agents enabled yet — turn one on below.
        </p>
      )}

      <Separator />

      <div className="space-y-3">
        {providers.map((p) => (
          <ProviderRow
            key={p.provider}
            slug={slug}
            provider={p}
            githubConnected={githubConnected}
            onChanged={handleChanged}
          />
        ))}
      </div>

      <Separator />

      <div className="text-[11px] text-muted-foreground space-y-1">
        <p>
          Each provider is a separate GitHub App/Action you install on your own repo — Autopilot
          only posts the trigger comment and links back the PR it opens.
        </p>
      </div>
    </div>
  );
}
