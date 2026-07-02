"use client";

import { useEffect, useState } from "react";
import { IconChevronDown, IconChevronUp, IconPlus, IconTrash } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api";

interface Scout {
  id: string;
  project_id: string;
  integration_id: string;
  name: string;
  tool_name: string;
  tool_arguments: Record<string, unknown>;
  objective: string;
  interval_seconds: number;
  enabled: boolean;
  last_run_at: string | null;
  last_finding_at: string | null;
  last_error: string | null;
  created_at: string;
}

interface ScoutTool {
  name: string;
  description: string;
}

const INTERVALS: { value: number; label: string }[] = [
  { value: 300, label: "5 min" },
  { value: 900, label: "15 min" },
  { value: 3600, label: "1 hour" },
];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function ScoutRow({
  slug,
  scout,
  onChanged,
  onDeleted,
}: {
  slug: string;
  scout: Scout;
  onChanged: (updated: Scout) => void;
  onDeleted: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ notable: boolean; summary: string | null; error: string | null } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const api = apiClient();

  const handleToggle = async (enabled: boolean) => {
    setToggling(true);
    try {
      const updated = await api.patch<Scout>(`/api/projects/${slug}/scouts/${scout.id}`, { enabled });
      onChanged(updated);
    } catch {
      // revert quietly
    } finally {
      setToggling(false);
    }
  };

  const handleRun = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const result = await api.post<{ notable: boolean; summary: string | null; error: string | null }>(
        `/api/projects/${slug}/scouts/${scout.id}/run`,
        {}
      );
      setRunResult(result);
      onChanged({
        ...scout,
        last_run_at: new Date().toISOString(),
        last_finding_at: result.notable ? new Date().toISOString() : scout.last_finding_at,
        last_error: result.error,
      });
    } catch (err) {
      setRunResult({ notable: false, summary: null, error: err instanceof Error ? err.message : "Run failed" });
    } finally {
      setRunning(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.del(`/api/projects/${slug}/scouts/${scout.id}`);
      onDeleted(scout.id);
    } catch {
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-md border p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium truncate">{scout.name}</p>
          <p className="text-[11px] text-muted-foreground font-mono truncate">{scout.tool_name}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Switch checked={scout.enabled} onCheckedChange={handleToggle} disabled={toggling} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            <IconTrash className="size-3" />
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {scout.last_run_at ? `Last run ${timeAgo(scout.last_run_at)}` : "Never run"}
        {scout.last_finding_at && ` · last finding ${timeAgo(scout.last_finding_at)}`}
      </p>
      {scout.last_error && <p className="text-[11px] text-destructive">{scout.last_error}</p>}

      <div className="flex items-center gap-3 text-[11px]">
        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          className="text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          {running ? "Running…" : "Run now"}
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? "Hide objective" : "Show objective"}
          {expanded ? <IconChevronUp className="size-3" /> : <IconChevronDown className="size-3" />}
        </button>
      </div>

      {expanded && <p className="text-[11px] text-muted-foreground italic">{scout.objective}</p>}

      {runResult && (
        <p className={cn("text-[11px]", runResult.error ? "text-destructive" : runResult.notable ? "text-amber-600" : "text-muted-foreground")}>
          {runResult.error
            ? runResult.error
            : runResult.notable
            ? `Finding: ${runResult.summary}`
            : "Nothing notable this run"}
        </p>
      )}
    </div>
  );
}

export default function ScoutsConfig({
  slug,
  integrationId,
  availableTools,
}: {
  slug: string;
  integrationId: string;
  availableTools: ScoutTool[] | null;
}) {
  const [scouts, setScouts] = useState<Scout[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [toolName, setToolName] = useState("");
  const [objective, setObjective] = useState("");
  const [toolArguments, setToolArguments] = useState("{}");
  const [interval, setInterval] = useState(900);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const api = apiClient();

  useEffect(() => {
    api.get<Scout[]>(`/api/projects/${slug}/scouts?integration_id=${integrationId}`)
      .then(setScouts)
      .catch(() => setScouts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integrationId]);

  const handleChanged = (updated: Scout) => {
    setScouts((prev) => (prev ? prev.map((s) => (s.id === updated.id ? updated : s)) : prev));
  };
  const handleDeleted = (id: string) => {
    setScouts((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
  };

  const resetForm = () => {
    setName("");
    setToolName("");
    setObjective("");
    setToolArguments("{}");
    setInterval(900);
    setError("");
  };

  const handleCreate = async () => {
    setSaving(true);
    setError("");
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = toolArguments.trim() ? JSON.parse(toolArguments) : {};
    } catch {
      setError("Arguments must be valid JSON");
      setSaving(false);
      return;
    }
    try {
      const created = await api.post<Scout>(`/api/projects/${slug}/scouts`, {
        integration_id: integrationId,
        name,
        tool_name: toolName,
        tool_arguments: parsedArgs,
        objective,
        interval_seconds: interval,
      });
      setScouts((prev) => [...(prev ?? []), created]);
      resetForm();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add scout");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">
          Scouts {scouts && scouts.length > 0 && `(${scouts.length})`}
        </Label>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Proactive checks — a scout calls one tool on a schedule and only creates an issue when
        an LLM decides the result is a genuine finding against your objective. Unlike sync above,
        it doesn&apos;t mirror everything the tool returns.
      </p>

      {scouts === null ? (
        <p className="text-[11px] text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-1.5">
          {scouts.map((s) => (
            <ScoutRow key={s.id} slug={slug} scout={s} onChanged={handleChanged} onDeleted={handleDeleted} />
          ))}
        </div>
      )}

      {!open ? (
        <Button type="button" variant="outline" size="sm" className="w-full gap-1.5" onClick={() => setOpen(true)}>
          <IconPlus className="size-3.5" />
          Add scout
        </Button>
      ) : (
        <div className="rounded-md border border-dashed p-2.5 space-y-2">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Checkout error rate watch"
              className="h-7 text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Tool</Label>
            {availableTools && availableTools.length > 0 ? (
              <select
                value={toolName}
                onChange={(e) => setToolName(e.target.value)}
                className="w-full h-7 text-xs rounded-md border bg-transparent px-2 font-mono"
              >
                <option value="">Select a tool…</option>
                {availableTools.map((t) => (
                  <option key={t.name} value={t.name}>{t.name}</option>
                ))}
              </select>
            ) : (
              <>
                <Input
                  value={toolName}
                  onChange={(e) => setToolName(e.target.value)}
                  placeholder="tool_name"
                  className="h-7 text-xs font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  Click Discover tools above to pick from a list instead.
                </p>
              </>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Arguments (JSON)</Label>
            <Textarea
              value={toolArguments}
              onChange={(e) => setToolArguments(e.target.value)}
              className="text-xs font-mono min-h-14"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Objective</Label>
            <Textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="Flag it if the error rate is meaningfully above normal for this time of day."
              className="text-xs min-h-16"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Check interval</Label>
            <div className="flex rounded-md border overflow-hidden text-xs">
              {INTERVALS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setInterval(value)}
                  className={cn(
                    "flex-1 py-1.5 font-medium transition-colors",
                    interval === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-[11px] text-destructive">{error}</p>}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleCreate}
              disabled={saving || !name.trim() || !toolName.trim() || !objective.trim()}
            >
              {saving ? "Adding…" : "Add scout"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { resetForm(); setOpen(false); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
