"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconCheck,
  IconChevronDown,
  IconFolder,
  IconHelpCircle,
  IconLayersIntersect,
  IconLayoutDashboard,
  IconLogout,
  IconPlus,
  IconPuzzle,
  IconSettings,
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
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Connect Stripe, Sentry, FullStory, and Zendesk. Autopilot reads the raw
                    events from all four, groups them by root cause, scores them by business
                    impact, and tells you what to fix first.
                  </p>

                  <hr />

                  <div className="space-y-5">
                    <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">What it does</h2>
                    {[
                      { title: "Ingests events from your existing tools", body: "Connect Stripe, Sentry, FullStory, and Zendesk via webhook or the simulate toggle for instant demo data. No new SDK to install." },
                      { title: "Groups events by root cause, not by source", body: "A Stripe payment failure, a Sentry exception, and a FullStory rage-click from the same checkout flow become one issue — not three separate alerts." },
                      { title: "Scores every issue by business impact", body: "Each issue gets a priority score based on revenue at risk, how often it occurs, and UX friction signals. The highest-impact problem is always at the top. You control the weights in Settings → Prioritization." },
                      { title: "Explains root cause and recommends a fix", body: "Open any issue to see what's happening, which users are affected across all your tools, what the likely cause is, and what to do about it." },
                      { title: "Files GitHub issues with one click", body: "Connect your GitHub repo in Settings. Every issue can be sent directly to your tracker — pre-written, with full context attached." },
                    ].map(({ title, body }) => (
                      <div key={title} className="space-y-1">
                        <p className="text-sm font-semibold">{title}</p>
                        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                      </div>
                    ))}
                  </div>

                  <hr />

                  <div className="space-y-4">
                    <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">How to get started</h2>
                    <ol className="space-y-4">
                      {[
                        { n: "1", text: "Create a project." },
                        { n: "2", text: "Go to Integrations. Connect a source or turn on Simulate to generate realistic demo events immediately." },
                        { n: "3", text: "Go to Issues. Autopilot groups and scores incoming events automatically. Critical issues appear at the top." },
                        { n: "4", text: "Open an issue to see the root cause, affected users, revenue impact, and recommended fix." },
                        { n: "5", text: "Optionally: go to Settings → Prioritization to adjust how revenue, frequency, and UX signals are weighted." },
                        { n: "6", text: "Optionally: go to Settings → GitHub to connect a repo and file issues directly from Autopilot." },
                      ].map(({ n, text }) => (
                        <li key={n} className="flex gap-3 text-sm">
                          <span className="shrink-0 size-5 rounded-full border flex items-center justify-center text-xs font-medium tabular-nums">
                            {n}
                          </span>
                          <span className="text-muted-foreground leading-relaxed pt-0.5">{text}</span>
                        </li>
                      ))}
                    </ol>
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
