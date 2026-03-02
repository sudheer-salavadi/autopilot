"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  IconCheck,
  IconChevronDown,
  IconFolder,
  IconHelpCircle,
  IconLayersIntersect,
  IconLayoutDashboard,
  IconLogout,
  IconMoon,
  IconPlus,
  IconPuzzle,
  IconSettings,
  IconSun,
} from "@tabler/icons-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

interface Project {
  id: string;
  name: string;
  slug: string;
}

interface User {
  id: string;
  email: string;
  name: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function AppSidebar({
  user,
  projects,
}: {
  user: User | null;
  projects: Project[];
}) {
  const pathname = usePathname();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch { /* ignore */ }
  }

  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  const currentSlug =
    projectMatch && projectMatch[1] !== "new" ? projectMatch[1] : null;
  const currentProject = projects.find((p) => p.slug === currentSlug) ?? null;

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton className="gap-2">
                  <IconFolder className="size-4 shrink-0" />
                  <span className="flex-1 truncate font-medium">
                    {currentProject?.name ?? "Select project"}
                  </span>
                  <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-52">
                {projects.map((p) => (
                  <DropdownMenuItem key={p.id} asChild>
                    <Link href={`/projects/${p.slug}`} className="flex items-center gap-2">
                      <span className="flex-1 truncate">{p.name}</span>
                      {p.slug === currentSlug && (
                        <IconCheck className="size-3.5 shrink-0" />
                      )}
                    </Link>
                  </DropdownMenuItem>
                ))}
                {projects.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem asChild>
                  <Link href="/projects/new" className="flex items-center gap-2">
                    <IconPlus className="size-4" />
                    New project
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {currentSlug && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === `/projects/${currentSlug}`}
                  >
                    <Link href={`/projects/${currentSlug}`}>
                      <IconLayoutDashboard />
                      Overview
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>                
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === `/projects/${currentSlug}/issues`}
                  >
                    <Link href={`/projects/${currentSlug}/issues`}>
                      <IconLayersIntersect />
                      Issues
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === `/projects/${currentSlug}/integrations`}
                  >
                    <Link href={`/projects/${currentSlug}/integrations`}>
                      <IconPuzzle />
                      Integrations
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname.startsWith(`/projects/${currentSlug}/settings`)}
                  >
                    <Link href={`/projects/${currentSlug}/settings`}>
                      <IconSettings />
                      Settings
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <Sheet>
              <SheetTrigger asChild>
                <SidebarMenuButton className="border hover:text-muted-foreground">
                  <IconHelpCircle />
                  How it works
                </SidebarMenuButton>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
                <SheetHeader className="pb-2">
                  <SheetTitle>How Autopilot works</SheetTitle>
                </SheetHeader>
                <div className="px-4 pb-8 space-y-8">

                  {/* The problem */}
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">The problem</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Product and engineering teams operate across four tools — Stripe for revenue,
                      Sentry for errors, FullStory for UX friction, Zendesk for support. Each fires
                      separate alerts. There is no shared view, no root cause, and no ranking.
                      The result: teams spend hours triaging noise and miss the issues that are
                      actually costing them money or users.
                    </p>
                  </div>

                  <hr />

                  {/* How it works */}
                  <div className="space-y-5">
                    <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">How Autopilot works</h2>
                    {[
                      { title: "Connect your existing tools", body: "Plug in Stripe, Sentry, FullStory, and Zendesk via webhook or flip the Simulate toggle for instant demo data. No new SDK to install." },
                      { title: "Autopilot groups ingested events by root cause", body: "A Stripe payment failure, a Sentry exception, and a FullStory rage-click from the same checkout flow become one issue — not three separate alerts." },
                      { title: "Every issue is scored by business impact", body: "Each issue gets a priority score based on revenue at risk, how often it occurs, and UX friction signals. The highest-impact problem surfaces at the top." },
                      { title: "Root cause and recommended fix included", body: "Open any issue to see what broke, which users are affected across all your tools, what the likely cause is, and what to do about it." },
                      { title: "Create a GitHub issue with one click", body: "Connect your GitHub repo in Settings. Any issue can be sent directly to your tracker — pre-written, with full context attached." },
                    ].map(({ title, body }) => (
                      <div key={title} className="space-y-1">
                        <p className="text-sm font-semibold">{title}</p>
                        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                      </div>
                    ))}
                  </div>

                  <hr />

                  {/* CTAs */}
                  <div className="flex gap-3">
                    <a
                      href={`${API_URL}/api/auth/login`}
                      className="inline-flex items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
                    >
                      Get started
                    </a>
                    <Link
                      href="/dashboard"
                      className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
                    >
                      Go to dashboard
                    </Link>
                  </div>

                </div>
              </SheetContent>
            </Sheet>
          </SidebarMenuItem>
          <SidebarMenuItem>
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton className="h-10 gap-2.5">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">
                      {(user.name ?? user.email)
                        .split(" ")
                        .map((w) => w[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </span>
                    <span className="flex-1 truncate text-sm">
                      {user.name || user.email}
                    </span>
                    <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="min-w-56">
                  <div className="px-2 py-1.5 space-y-0.5">
                    <p className="text-sm font-medium truncate">{user.name || user.email}</p>
                    {user.name && (
                      <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                    )}
                    {/* <p className="truncate font-mono text-[11px] text-muted-foreground/60">
                      {user.id}
                    </p> */}
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={toggleTheme} className="flex items-center gap-2 cursor-pointer">
                    {isDark
                      ? <IconSun className="size-4" />
                      : <IconMoon className="size-4" />}
                    {isDark ? "Light mode" : "Dark mode"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a href={`${API_URL}/api/auth/logout`} className="flex items-center gap-2">
                      <IconLogout className="size-4" />
                      Sign out
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <SidebarMenuButton asChild>
                <a href={`${API_URL}/api/auth/logout`}>
                  <IconLogout />
                  Sign out
                </a>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
