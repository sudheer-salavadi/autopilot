"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Account", segment: "account" },
  { label: "Team", segment: "team" },
  { label: "Activity", segment: "activity" },
  { label: "Billing", segment: "billing" },
  { label: "Severity", segment: "prioritization" },
];

// Instance-level user management — only rendered for instance admins
const ADMIN_TAB = { label: "Team & access", segment: "access" };

export function SettingsTabs({
  slug,
  isInstanceAdmin = false,
}: {
  slug: string;
  isInstanceAdmin?: boolean;
}) {
  const pathname = usePathname();
  const tabs = isInstanceAdmin ? [...TABS, ADMIN_TAB] : TABS;

  return (
    <nav className="flex border-b mb-6">
      {tabs.map((tab) => {
        const href = `/projects/${slug}/settings/${tab.segment}`;
        const isActive = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={tab.segment}
            href={href}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              isActive
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
