import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import AppSidebar from "@/components/AppSidebar";
import { apiServer } from "@/lib/api-server";

interface User {
  id: string;
  email: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
  slug: string;
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [userResult, projectsResult] = await Promise.allSettled([
    apiServer<User>("/api/auth/me"),
    apiServer<Project[]>("/api/projects"),
  ]);

  const user = userResult.status === "fulfilled" ? userResult.value : null;
  const projects = projectsResult.status === "fulfilled" ? projectsResult.value : [];

  return (
    <SidebarProvider>
      <AppSidebar user={user} projects={projects} />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="h-4" />
        </header>
        <div className="flex flex-1 flex-col p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
