"use client";

import { useState } from "react";
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconExternalLink,
  IconPlus,
  IconRobot,
  IconTrash,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  is_custom: boolean;
  setup_docs_url: string | null;
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function ProviderRow({
  slug,
  provider,
  githubConnected,
  onChanged,
  onDeleted,
}: {
  slug: string;
  provider: AgentProvider;
  githubConnected: boolean;
  onChanged: (updated: AgentProvider) => void;
  onDeleted: (provider: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draftTemplate, setDraftTemplate] = useState(provider.trigger_template);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
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

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      await api.del(`/api/projects/${slug}/agent-config/${provider.provider}`);
      onDeleted(provider.provider);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete");
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium">{provider.name}</p>
            {provider.is_custom && (
              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">Custom</Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {provider.enabled
              ? "Enabled — the trigger comment below is posted when you click \"Fix with " +
                provider.name + "\" on an issue."
              : "Disabled — won't appear in the \"Fix with…\" menu on issues."}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Switch
            checked={provider.enabled}
            onCheckedChange={handleToggle}
            disabled={toggling}
          />
          {provider.is_custom && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-destructive"
              onClick={handleDelete}
              disabled={deleting}
              title="Remove custom provider"
            >
              <IconTrash className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 text-[11px]">
        {provider.setup_docs_url && (
          <a
            href={provider.setup_docs_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            Setup guide for {provider.name}
            <IconExternalLink className="size-3" />
          </a>
        )}
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
        that {provider.name}&apos;s GitHub App/Action is installed{provider.setup_docs_url ? " (see setup guide)" : ""} and that its
        trigger phrase matches what&apos;s below.
      </p>

      {deleteError && <p className="text-[11px] text-destructive">{deleteError}</p>}

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

function AddCustomAgentForm({
  slug,
  existingProviders,
  onCreated,
}: {
  slug: string;
  existingProviders: string[];
  onCreated: (created: AgentProvider) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [providerSlug, setProviderSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [template, setTemplate] = useState("");
  const [docsUrl, setDocsUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const api = apiClient();

  const effectiveSlug = slugEdited ? providerSlug : slugify(name);
  const slugTaken = existingProviders.includes(effectiveSlug);

  const reset = () => {
    setName("");
    setProviderSlug("");
    setSlugEdited(false);
    setTemplate("");
    setDocsUrl("");
    setError("");
  };

  const handleCreate = async () => {
    setSaving(true);
    setError("");
    try {
      const created = await api.post<AgentProvider>(`/api/projects/${slug}/agent-config`, {
        provider: effectiveSlug,
        name,
        trigger_template: template,
        setup_docs_url: docsUrl || null,
      });
      onCreated(created);
      reset();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add provider");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <IconPlus className="size-3.5" />
        Add custom agent
      </Button>
    );
  }

  const canCreate = name.trim() && effectiveSlug && !slugTaken && template.trim();

  return (
    <div className="rounded-md border border-dashed p-3 space-y-3">
      <p className="text-xs font-medium">Add a custom coding agent</p>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Any agent that watches GitHub issue comments and opens a PR works here — Autopilot just
        needs its name and trigger phrase.
      </p>

      <div className="space-y-1.5">
        <Label className="text-xs">Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Cursor Background Agent"
          className="h-8 text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Provider ID</Label>
        <Input
          value={effectiveSlug}
          onChange={(e) => { setProviderSlug(e.target.value); setSlugEdited(true); }}
          placeholder="cursor"
          className="h-8 text-xs font-mono"
        />
        {slugTaken && (
          <p className="text-[11px] text-destructive">A provider with this ID already exists.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Trigger comment</Label>
        <Textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          placeholder="@cursor please fix this issue based on the context above and open a PR."
          className="text-xs font-mono min-h-16"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Setup docs URL (optional)</Label>
        <Input
          value={docsUrl}
          onChange={(e) => setDocsUrl(e.target.value)}
          placeholder="https://…"
          className="h-8 text-xs"
        />
      </div>

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={handleCreate} disabled={!canCreate || saving}>
          {saving ? "Adding…" : "Add provider"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => { reset(); setOpen(false); }}>
          Cancel
        </Button>
      </div>
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

  const handleCreated = (created: AgentProvider) => {
    setProviders((prev) => [...prev, created]);
  };

  const handleDeleted = (providerId: string) => {
    setProviders((prev) => prev.filter((p) => p.provider !== providerId));
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
          No coding agents enabled yet — turn one on below, or add your own.
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
            onDeleted={handleDeleted}
          />
        ))}
      </div>

      <AddCustomAgentForm
        slug={slug}
        existingProviders={providers.map((p) => p.provider)}
        onCreated={handleCreated}
      />

      <Separator />

      <div className="text-[11px] text-muted-foreground space-y-1">
        <p>
          Each provider is a separate GitHub App/Action you install on your own repo — Autopilot
          only posts the trigger comment and links back the PR it opens. Not one of Claude, Codex,
          or Gemini? Add any other agent above — Autopilot doesn&apos;t need a code change to
          support a new one.
        </p>
      </div>
    </div>
  );
}
