"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiClient } from "@/lib/api";

type IntegrationType = "stripe" | "sentry";

export default function IntegrationForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [type, setType] = useState<IntegrationType>("stripe");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const api = apiClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.post(`/api/projects/${slug}/integrations`, {
        type,
        webhook_secret: secret,
      });
      setSecret("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save integration");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
      <div className="space-y-1.5">
        <Label htmlFor="type">Provider</Label>
        <Select value={type} onValueChange={(v) => setType(v as IntegrationType)}>
          <SelectTrigger id="type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stripe">Stripe</SelectItem>
            <SelectItem value="sentry">Sentry</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="secret">Webhook Secret</Label>
        <Input
          id="secret"
          type="password"
          required
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={type === "stripe" ? "whsec_…" : "your-sentry-secret"}
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Stored encrypted (AES-128 + HMAC-SHA256). Never shown again.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : "Save Integration"}
      </Button>
    </form>
  );
}
