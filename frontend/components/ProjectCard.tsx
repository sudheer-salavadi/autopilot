import Link from "next/link";
import { IconArrowRight } from "@tabler/icons-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Project {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export default function ProjectCard({ project }: { project: Project }) {
  return (
    <Card size="sm" className="hover:ring-foreground/20 transition-all">
      <CardHeader>
        <CardTitle>
          <Link
            href={`/projects/${project.slug}`}
            className="hover:underline underline-offset-2"
          >
            {project.name}
          </Link>
        </CardTitle>
        <CardDescription className="font-mono">{project.slug}</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="icon-sm">
            <Link href={`/projects/${project.slug}`} aria-label="Open project">
              <IconArrowRight />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
    </Card>
  );
}
