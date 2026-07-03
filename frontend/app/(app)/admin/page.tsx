"use client";

import { useEffect, useState } from "react";
import { IconKey, IconTrash, IconUserPlus } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiClient } from "@/lib/api";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  has_password: boolean;
  owned_projects: number;
  memberships: number;
  created_at: string;
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");

  // Create-user form
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);

  const api = apiClient();

  const fetchUsers = async () => {
    setLoading(true);
    try {
      setUsers(await api.get<AdminUser[]>("/api/admin/users"));
      setForbidden(false);
    } catch {
      setForbidden(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      const user = await api.post<AdminUser>("/api/admin/users", {
        email: newEmail,
        name: newName,
        password: newPassword,
      });
      setUsers((prev) => [...prev, user]);
      setNewEmail("");
      setNewName("");
      setNewPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  const setRole = async (u: AdminUser, role: "admin" | "member") => {
    setError("");
    try {
      const updated = await api.patch<AdminUser>(`/api/admin/users/${u.id}`, { role });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change role");
    }
  };

  const resetPassword = async (u: AdminUser) => {
    const pw = window.prompt(`New password for ${u.email} (min 8 characters):`);
    if (!pw) return;
    setError("");
    try {
      const updated = await api.patch<AdminUser>(`/api/admin/users/${u.id}`, {
        new_password: pw,
      });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    }
  };

  const remove = async (u: AdminUser) => {
    if (!confirm(`Delete ${u.email}? Their project memberships are removed too.`)) return;
    setError("");
    try {
      await api.del(`/api/admin/users/${u.id}`);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete user");
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground animate-pulse">Loading users…</p>;
  }

  if (forbidden) {
    return (
      <div className="max-w-2xl space-y-2">
        <h1 className="text-xl font-semibold">Team &amp; access</h1>
        <p className="text-sm text-muted-foreground">
          Instance admin role required. Ask an admin to promote your account.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Team &amp; access</h1>
        <p className="text-sm text-muted-foreground">
          Everyone with an account on this instance. Instance <strong>admins</strong> manage
          users here; access to each project is still granted per project under
          Settings → Team.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-xl ring-1 ring-foreground/10 divide-y overflow-hidden">
        {users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-4 py-3 bg-card">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {u.name || u.email}
                {!u.has_password && (
                  <Badge variant="outline" className="ml-2">no password</Badge>
                )}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {u.email} · {u.owned_projects} project{u.owned_projects === 1 ? "" : "s"} owned
                · member of {u.memberships}
              </p>
            </div>
            <Select value={u.role} onValueChange={(v) => setRole(u, v as "admin" | "member")}>
              <SelectTrigger className="w-28" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="member">Member</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => resetPassword(u)} title="Reset password">
              <IconKey className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => remove(u)} title="Delete user">
              <IconTrash className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <form onSubmit={createUser} className="space-y-3 rounded-xl ring-1 ring-foreground/10 bg-card p-4">
        <p className="text-sm font-medium flex items-center gap-2">
          <IconUserPlus className="size-4" /> Add a user
        </p>
        <p className="text-xs text-muted-foreground">
          Creates the account directly with a starting password — useful when signups are
          locked with <code>DISABLE_SIGNUP=true</code>. Share the password with them; they
          can change it in account settings.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            type="email"
            required
            placeholder="email@example.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <Input
            placeholder="Name (optional)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Input
            type="text"
            required
            minLength={8}
            placeholder="Starting password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <Button type="submit" disabled={creating}>
            {creating ? "…" : "Add"}
          </Button>
        </div>
      </form>
    </div>
  );
}
