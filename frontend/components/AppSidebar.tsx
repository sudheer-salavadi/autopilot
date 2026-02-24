"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconCheck,
  IconChevronDown,
  IconFolder,
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
          {user && (
            <SidebarMenuItem>
              <div className="flex flex-col px-2 py-1">
                <span className="text-sm font-medium truncate">
                  {user.name || user.email}
                </span>
                {user.name && (
                  <span className="text-xs text-muted-foreground truncate">
                    {user.email}
                  </span>
                )}
              </div>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <a href={`${API_URL}/api/auth/logout`}>
                <IconLogout />
                Sign out
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
