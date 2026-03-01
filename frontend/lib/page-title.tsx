"use client";

import { createContext, useCallback, useContext, useState } from "react";

const PageTitleContext = createContext<{
  title: string;
  setTitle: (title: string) => void;
}>({ title: "", setTitle: () => {} });

export function PageTitleProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState("");
  const set = useCallback((t: string) => setTitle(t), []);
  return (
    <PageTitleContext.Provider value={{ title, setTitle: set }}>
      {children}
    </PageTitleContext.Provider>
  );
}

export function usePageTitle() {
  return useContext(PageTitleContext).title;
}

export function useSetPageTitle() {
  return useContext(PageTitleContext).setTitle;
}
