"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchRateMap } from "./use-card-data";

export type DisplayCurrency = "none" | "USD" | "JPY";

export const CURRENCY_LABELS: Record<DisplayCurrency, string> = {
  none: "None",
  USD: "$USD",
  JPY: "¥JPY",
};

interface ConvertedPrice {
  price: number;
  symbol: string;
}

interface CurrencyContextValue {
  displayCurrency: DisplayCurrency;
  setDisplayCurrency: (c: DisplayCurrency) => void;
  convertPrice: (price: number, fromCurrencyCode: string) => ConvertedPrice;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

const TARGET_SYMBOLS: Record<string, string> = {
  USD: "$",
  JPY: "¥",
};

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [displayCurrency, setDisplayCurrencyState] = useState<DisplayCurrency>("none");
  const [rateMap, setRateMap] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    const stored = localStorage.getItem("displayCurrency");
    if (stored === "none" || stored === "USD" || stored === "JPY") {
      setDisplayCurrencyState(stored);
    }
  }, []);

  useEffect(() => {
    if (displayCurrency === "none") return;
    const supabase = createClient();
    fetchRateMap(supabase).then(setRateMap);
  }, [displayCurrency]);

  function setDisplayCurrency(c: DisplayCurrency) {
    setDisplayCurrencyState(c);
    localStorage.setItem("displayCurrency", c);
  }

  const convertPrice = useCallback(
    (price: number, fromCurrencyCode: string): ConvertedPrice => {
      if (displayCurrency === "none") {
        return { price, symbol: "" };
      }
      if (fromCurrencyCode === displayCurrency) {
        return { price, symbol: TARGET_SYMBOLS[displayCurrency] };
      }
      const fromRate = fromCurrencyCode === "USD" ? 1 : (rateMap.get(fromCurrencyCode) ?? 1);
      const targetRate = displayCurrency === "USD" ? 1 : (rateMap.get(displayCurrency) ?? 1);
      const converted = price * fromRate / targetRate;
      return {
        price: Math.round(converted * 100) / 100,
        symbol: TARGET_SYMBOLS[displayCurrency],
      };
    },
    [displayCurrency, rateMap]
  );

  return (
    <CurrencyContext value={{ displayCurrency, setDisplayCurrency, convertPrice }}>
      {children}
    </CurrencyContext>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used within CurrencyProvider");
  return ctx;
}
