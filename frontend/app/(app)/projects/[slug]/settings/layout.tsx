import { SettingsTabs } from "@/components/SettingsTabs";
import { PageTitle } from "@/components/PageTitle";

export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <>
      <PageTitle title="Settings" />
      <SettingsTabs slug={slug} />
      {children}
    </>
  );
}
