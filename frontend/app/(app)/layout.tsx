import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import AppSidebar from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { PageTitleProvider } from "@/lib/page-title";
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
        <PageTitleProvider>
          <AppHeader />
          <div className="flex flex-1 flex-col p-6">{children}</div>
        </PageTitleProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
