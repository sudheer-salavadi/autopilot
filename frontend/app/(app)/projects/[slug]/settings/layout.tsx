import { SettingsTabs } from "@/components/SettingsTabs";
import { PageTitle } from "@/components/PageTitle";
import { apiServer } from "@/lib/api-server";

interface User {
  id: string;
  email: string;
  name: string;
  role?: "admin" | "member";
}

export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let isInstanceAdmin = false;
  try {
    const me = await apiServer<User>("/api/auth/me");
    isInstanceAdmin = me.role === "admin";
  } catch {
    // Not authenticated — middleware will redirect; render without the tab
  }

  return (
    <>
      <PageTitle title="Settings" />
      <SettingsTabs slug={slug} isInstanceAdmin={isInstanceAdmin} />
      {children}
    </>
  );
}
