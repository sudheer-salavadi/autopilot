"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { usePageTitle } from "@/lib/page-title";
import { AskAIButton } from "@/components/AskAI";

export function AppHeader() {
  const title = usePageTitle();
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="h-4" />
      {title && <span className="text-sm font-semibold">{title}</span>}
      <AskAIButton />
    </header>
  );
}
