"use client";

import { useEffect } from "react";
import { useSetPageTitle } from "@/lib/page-title";

export function PageTitle({ title }: { title: string }) {
  const setTitle = useSetPageTitle();
  useEffect(() => {
    setTitle(title);
  }, [title, setTitle]);
  return null;
}
