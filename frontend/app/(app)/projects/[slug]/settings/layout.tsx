import { SettingsTabs } from "@/components/SettingsTabs";

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
      <h1 className="text-2xl font-bold mb-4">Settings</h1>
      <SettingsTabs slug={slug} />
      {children}
    </>
  );
}
