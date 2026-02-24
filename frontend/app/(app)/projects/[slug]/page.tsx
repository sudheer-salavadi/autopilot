import { apiServer } from "@/lib/api-server";
import { Separator } from "@/components/ui/separator";
import EventsFeed from "@/components/EventsFeed";

interface Project {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await apiServer<Project>(`/api/projects/${slug}`);

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">{project.name}</h1>
        <p className="text-sm text-muted-foreground font-mono mt-1">{project.slug}</p>
      </div>

      <Separator />

      <section>
        <h2 className="text-base font-semibold mb-4">Recent Events</h2>
        <EventsFeed slug={slug} />
      </section>
    </>
  );
}
