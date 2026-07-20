"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type ExitPercentile = 10 | 25 | 50;

const STORAGE_KEY = "conservativeExitPercentile";

interface ExitBasisContextValue {
  exitPercentile: ExitPercentile;
  setExitPercentile: (percentile: ExitPercentile) => void;
}

const ExitBasisContext = createContext<ExitBasisContextValue | null>(null);

export function ExitBasisProvider({ children }: { children: React.ReactNode }) {
  const [exitPercentile, setExitPercentileState] = useState<ExitPercentile>(25);

  useEffect(() => {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    if (stored === 10 || stored === 25 || stored === 50) {
      setExitPercentileState(stored);
    }
  }, []);

  function setExitPercentile(percentile: ExitPercentile) {
    setExitPercentileState(percentile);
    localStorage.setItem(STORAGE_KEY, String(percentile));
  }

  return (
    <ExitBasisContext value={{ exitPercentile, setExitPercentile }}>
      {children}
    </ExitBasisContext>
  );
}

export function useExitBasis() {
  const context = useContext(ExitBasisContext);
  if (!context) throw new Error("useExitBasis must be used within ExitBasisProvider");
  return context;
}
