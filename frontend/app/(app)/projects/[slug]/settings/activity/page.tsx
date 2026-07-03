import { Separator } from "@/components/ui/separator";
import ProjectActivity from "@/components/ProjectActivity";

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <section className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-base font-semibold">Activity</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Who did what: issues filed, coding agents triggered, status and
          membership changes — including Autopilot&apos;s automatic actions.
        </p>
      </div>
      <Separator />
      <ProjectActivity slug={slug} />
    </section>
  );
}
