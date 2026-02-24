import { apiServer } from "@/lib/api-server";
import { Separator } from "@/components/ui/separator";
import MembersList from "@/components/MembersList";

interface Project {
  id: string;
  name: string;
  slug: string;
}

export default async function TeamPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await apiServer<Project>(`/api/projects/${slug}`);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Members</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage who has access to {project.name}.
        </p>
      </div>
      <Separator />
      <MembersList slug={slug} />
    </section>
  );
}
