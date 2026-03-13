"use client";

import { createContext, useContext, useState } from "react";

interface HeaderContextValue {
  headerActions: React.ReactNode;
  setHeaderActions: (node: React.ReactNode) => void;
}

const HeaderContext = createContext<HeaderContextValue | null>(null);

export function HeaderProvider({ children }: { children: React.ReactNode }) {
  const [headerActions, setHeaderActions] = useState<React.ReactNode>(null);
  return (
    <HeaderContext value={{ headerActions, setHeaderActions }}>
      {children}
    </HeaderContext>
  );
}

export function useHeader() {
  const ctx = useContext(HeaderContext);
  if (!ctx) throw new Error("useHeader must be used within HeaderProvider");
  return ctx;
}
