import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fetchRateMap } from "@/app/dashboard/use-card-data";

// Live FX from the auto-updated `exchange_rates` table (to_currency = USD), so
// transaction entry forms default to the accurate market rate instead of a
// hand-typed rounded fraction. USD is always 1; an unknown currency returns null
// so the caller keeps whatever the user has (never silently forces a wrong rate).
export function useFxRate() {
  const [rateMap, setRateMap] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    fetchRateMap(createClient()).then(setRateMap).catch(() => {});
  }, []);

  const rateFor = useCallback(
    (cur: string): number | null => {
      const c = (cur || "").toUpperCase();
      if (!c || c === "USD") return 1;
      return rateMap?.get(c) ?? null;
    },
    [rateMap]
  );

  return { rateFor };
}

// Render a rate into an <input type="number">: full stored precision (8 dp),
// trailing zeros trimmed so "0.00616793" not "0.00616793000".
export function fmtRate(r: number): string {
  return String(Number(r.toFixed(8)));
}
