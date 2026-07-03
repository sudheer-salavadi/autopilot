"use client";

import { useState } from "react";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  slug: string;
  projectName: string;
  userName: string;
}

export default function AccountSettings({ slug, projectName, userName }: Props) {
  // Project name state
  const [name, setName] = useState(projectName);
  const [nameStatus, setNameStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [nameError, setNameError] = useState<string | null>(null);

  // User name state — split into first / last
  const parts = userName.trim().split(/\s+/);
  const [firstName, setFirstName] = useState(parts[0] ?? "");
  const [lastName, setLastName] = useState(parts.slice(1).join(" ") ?? "");
  const [userStatus, setUserStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [userError, setUserError] = useState<string | null>(null);

  async function saveProjectName(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setNameStatus("saving");
    setNameError(null);
    try {
      await apiClient().put(`/api/projects/${slug}`, { name: name.trim() });
      setNameStatus("saved");
      setTimeout(() => setNameStatus("idle"), 2000);
    } catch {
      setNameStatus("error");
      setNameError("Failed to update project name.");
    }
  }

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwStatus, setPwStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [pwError, setPwError] = useState<string | null>(null);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwStatus("saving");
    setPwError(null);
    try {
      await apiClient().post(`/api/auth/change-password`, {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setPwStatus("saved");
      setCurrentPassword("");
      setNewPassword("");
      setTimeout(() => setPwStatus("idle"), 2000);
    } catch (err) {
      setPwStatus("error");
      setPwError(err instanceof Error ? err.message : "Failed to change password.");
    }
  }

  async function saveUserName(e: React.FormEvent) {
    e.preventDefault();
    const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
    if (!fullName) return;
    setUserStatus("saving");
    setUserError(null);
    try {
      await apiClient().put(`/api/auth/me`, { name: fullName });
      setUserStatus("saved");
      setTimeout(() => setUserStatus("idle"), 2000);
    } catch {
      setUserStatus("error");
      setUserError("Failed to update name.");
    }
  }

  return (
    <div className="space-y-8 max-w-lg">
      {/* Project name */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Project name</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Update the display name for this project.
          </p>
        </div>
        <form onSubmit={saveProjectName} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameStatus("idle"); }}
              placeholder="My project"
              disabled={nameStatus === "saving"}
            />
          </div>
          {nameError && <p className="text-sm text-destructive">{nameError}</p>}
          <Button
            type="submit"
            size="sm"
            disabled={nameStatus === "saving" || !name.trim() || name.trim() === projectName}
          >
            {nameStatus === "saving" ? "Saving…" : nameStatus === "saved" ? "Saved" : "Save"}
          </Button>
        </form>
      </section>

      <hr />

      {/* User name */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Your name</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Update the name shown for your account.
          </p>
        </div>
        <form onSubmit={saveUserName} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="first-name">First name</Label>
              <Input
                id="first-name"
                value={firstName}
                onChange={(e) => { setFirstName(e.target.value); setUserStatus("idle"); }}
                placeholder="First"
                disabled={userStatus === "saving"}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="last-name">Last name</Label>
              <Input
                id="last-name"
                value={lastName}
                onChange={(e) => { setLastName(e.target.value); setUserStatus("idle"); }}
                placeholder="Last"
                disabled={userStatus === "saving"}
              />
            </div>
          </div>
          {userError && <p className="text-sm text-destructive">{userError}</p>}
          <Button
            type="submit"
            size="sm"
            disabled={
              userStatus === "saving" ||
              ![firstName.trim(), lastName.trim()].filter(Boolean).join(" ")
            }
          >
            {userStatus === "saving" ? "Saving…" : userStatus === "saved" ? "Saved" : "Save"}
          </Button>
        </form>
      </section>

      <hr />

      {/* Password */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Password</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Change the password you sign in with. Forgot it? An instance admin
            can reset it from Team &amp; access.
          </p>
        </div>
        <form onSubmit={changePassword} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => { setCurrentPassword(e.target.value); setPwStatus("idle"); }}
              disabled={pwStatus === "saving"}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setPwStatus("idle"); }}
              placeholder="At least 8 characters"
              disabled={pwStatus === "saving"}
            />
          </div>
          {pwError && <p className="text-sm text-destructive">{pwError}</p>}
          <Button
            type="submit"
            size="sm"
            disabled={pwStatus === "saving" || !currentPassword || newPassword.length < 8}
          >
            {pwStatus === "saving" ? "Saving…" : pwStatus === "saved" ? "Changed" : "Change password"}
          </Button>
        </form>
      </section>
    </div>
  );
}
