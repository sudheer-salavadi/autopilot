import { redirect } from "next/navigation";
import Link from "next/link";
import { IconPlus } from "@tabler/icons-react";
import { apiServer } from "@/lib/api-server";
import { Button } from "@/components/ui/button";

interface Project {
  id: string;
  slug: string;
}

export default async function DashboardPage() {
  let projects: Project[] = [];
  try {
    projects = await apiServer<Project[]>("/api/projects");
  } catch {
    // handle gracefully
  }

  if (projects.length > 0) {
    redirect(`/projects/${projects[0].slug}`);
  }

  return (
    <div className="flex flex-1 items-center justify-center py-20">
      <div className="text-center space-y-4 max-w-sm">
        <h1 className="text-2xl font-bold">Welcome to Autopilot</h1>
        <p className="text-muted-foreground text-sm">
          Create your first project to start ingesting webhook events.
        </p>
        <Button asChild>
          <Link href="/projects/new">
            <IconPlus />
            New Project
          </Link>
        </Button>
      </div>
    </div>
  );
}
