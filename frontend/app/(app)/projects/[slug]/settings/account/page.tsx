import { apiServer } from "@/lib/api-server";
import AccountSettings from "@/components/AccountSettings";

interface Project {
  name: string;
  slug: string;
}

interface User {
  id: string;
  email: string;
  name: string;
}

export default async function AccountPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [project, user] = await Promise.all([
    apiServer<Project>(`/api/projects/${slug}`),
    apiServer<User>(`/api/auth/me`),
  ]);

  return <AccountSettings slug={slug} projectName={project.name} userName={user.name} />;
}
