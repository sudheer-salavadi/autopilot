"use client";

import { useEffect, useState } from "react";
import posthog from "posthog-js";
import { IconTrash, IconUserPlus } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { apiClient } from "@/lib/api";

interface Member {
  id: string;
  user_id: string;
  role: "owner" | "member";
  email: string;
  name: string;
  created_at: string;
}

export default function MembersList({ slug }: { slug: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState("");

  const api = apiClient();

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const data = await api.get<Member[]>(`/api/projects/${slug}/members`);
      setMembers(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInviting(true);
    try {
      const member = await api.post<Member>(`/api/projects/${slug}/members`, {
        email,
        role: "member",
      });
      setMembers((prev) => [...prev, member]);
      setEmail("");
      posthog.capture("team_member_invited", {
        project_slug: slug,
        invited_email: email,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite");
      posthog.captureException(err);
    } finally {
      setInviting(false);
    }
  };

  const remove = async (userId: string) => {
    if (!confirm("Remove this member?")) return;
    try {
      await api.del(`/api/projects/${slug}/members/${userId}`);
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
      posthog.capture("team_member_removed", {
        project_slug: slug,
        removed_user_id: userId,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to remove");
      posthog.captureException(err);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground animate-pulse">Loading members…</p>;
  }

  return (
    <div className="space-y-4">
      {/* Member list */}
      <div className="rounded-xl ring-1 ring-foreground/10 divide-y overflow-hidden">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between px-4 py-3 bg-card">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{m.name || m.email}</p>
              <p className="text-xs text-muted-foreground truncate">{m.email}</p>
            </div>
            <div className="flex items-center gap-2 ml-4 shrink-0">
              <Badge variant={m.role === "owner" ? "default" : "outline"}>
                {m.role}
              </Badge>
              {m.role !== "owner" && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(m.user_id)}
                  aria-label="Remove member"
                  className="text-muted-foreground hover:text-destructive"
                >
                  <IconTrash />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Separator />

      {/* Invite form */}
      <form onSubmit={invite} className="flex gap-2 max-w-md">
        <Input
          type="email"
          required
          placeholder="colleague@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit" disabled={inviting} size="default">
          <IconUserPlus />
          {inviting ? "Inviting…" : "Invite"}
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
