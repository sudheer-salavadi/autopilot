"use client";

import { useState } from "react";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ScoringConfig {
  project_id: string;
  weight_revenue: number;
  weight_frequency: number;
  weight_ux: number;
  max_revenue_usd: number;
  max_frequency_count: number;
}

export default function PrioritizationConfig({
  slug,
  initialConfig,
}: {
  slug: string;
  initialConfig: ScoringConfig;
}) {
  const [revenue, setRevenue] = useState(
    Math.round(initialConfig.weight_revenue * 100)
  );
  const [frequency, setFrequency] = useState(
    Math.round(initialConfig.weight_frequency * 100)
  );
  const [ux, setUx] = useState(Math.round(initialConfig.weight_ux * 100));
  const [maxRevenue, setMaxRevenue] = useState(initialConfig.max_revenue_usd);
  const [maxFreq, setMaxFreq] = useState(initialConfig.max_frequency_count);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const total = revenue + frequency + ux;
  const isValid = total === 100 && revenue > 0 && frequency > 0 && ux > 0;

  const api = apiClient();

  async function handleSave() {
    if (!isValid) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.put(`/api/projects/${slug}/scoring-config`, {
        weight_revenue: revenue / 100,
        weight_frequency: frequency / 100,
        weight_ux: ux / 100,
        max_revenue_usd: maxRevenue,
        max_frequency_count: maxFreq,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-lg gap-6">

      <div className=" grid grid-cols-2 ">

      {/* Card 1 — Severity Weights */}
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Severity Weights</h2>
          <p className="text-xs text-muted-foreground">
            How much each signal contributes to the severity score. Must sum to 100%.
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="revenue">Revenue Impact (%)</Label>
            <Input
              id="revenue"
              type="number"
              min={1}
              max={98}
              value={revenue}
              onChange={(e) => setRevenue(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="frequency">Frequency (%)</Label>
            <Input
              id="frequency"
              type="number"
              min={1}
              max={98}
              value={frequency}
              onChange={(e) => setFrequency(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ux">UX Impact (%)</Label>
            <Input
              id="ux"
              type="number"
              min={1}
              max={98}
              value={ux}
              onChange={(e) => setUx(Number(e.target.value))}
            />
          </div>
        </div>

        <div
          className={`rounded-md border px-3 py-2 text-xs font-mono ${
            total === 100
              ? "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}
        >
          {total === 100
            ? `Score = (Rev × ${(revenue / 100).toFixed(2)}) + (Freq × ${(frequency / 100).toFixed(2)}) + (UX × ${(ux / 100).toFixed(2)})`
            : `Sum = ${total}% — must equal 100%`}
        </div>
      </div>

      {/* Card 2 — Normalization Caps */}
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Normalization Caps</h2>
          <p className="text-xs text-muted-foreground">
            Revenue and frequency signals are scaled against these maximums before scoring.
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="maxRevenue">Max Revenue (USD)</Label>
            <Input
              id="maxRevenue"
              type="number"
              min={1}
              value={maxRevenue}
              onChange={(e) => setMaxRevenue(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="maxFreq">Max Event Count</Label>
            <Input
              id="maxFreq"
              type="number"
              min={1}
              value={maxFreq}
              onChange={(e) => setMaxFreq(Number(e.target.value))}
            />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>

      <div className="my-4 pt-6 h-2 border-t w-full flex justify-end items-center"> 
         <Button onClick={handleSave} disabled={!isValid || saving} className="w-fit">
        {saving ? "Saving…" : saved ? "Saved!" : "Save"}
      </Button>
      </div>

     
    </div>
  );
}
