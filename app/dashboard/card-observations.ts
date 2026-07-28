"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// The operator's own on-the-ground observations for a card, aggregated: how many
// were logged, and the cheapest one (its original price + USD-normalized value).
export interface CardObservation {
  count: number;
  cheapestUsd: number | null;
  cheapestOrig: number | null;
  cheapestCurrency: string | null;
  lastAt: string | null;
}

// One page of the card browser -> one observation lookup. Pokemon-only (the deal
// subsystem is Pokemon-only); other games get an empty map so numeric card_id
// overlap can't false-match.
export function useCardObservations(
  game: string,
  cardIds: Array<number | string>,
): ReadonlyMap<string, CardObservation> {
  const [map, setMap] = useState<ReadonlyMap<string, CardObservation>>(new Map());
  const ids = useMemo(
    () => [...new Set(cardIds.filter((v) => v != null).map(String))].sort((a, b) => a.localeCompare(b)),
    [cardIds],
  );
  const idsKey = ids.join(",");

  useEffect(() => {
    if (game !== "pokemon" || ids.length === 0) { setMap(new Map()); return; }
    let cancelled = false;
    const supabase = createClient();
    void supabase
      .from("trip_observations_v")
      .select("card_id, price_usd, observed_price, currency, observed_at")
      .in("card_id", ids)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setMap(new Map()); return; }
        const m = new Map<string, CardObservation>();
        for (const r of (data as Record<string, unknown>[] | null) ?? []) {
          const k = String(r.card_id);
          const cur = m.get(k) ?? { count: 0, cheapestUsd: null, cheapestOrig: null, cheapestCurrency: null, lastAt: null };
          cur.count += 1;
          const pu = Number(r.price_usd);
          if (cur.cheapestUsd == null || pu < cur.cheapestUsd) {
            cur.cheapestUsd = pu;
            cur.cheapestOrig = Number(r.observed_price);
            cur.cheapestCurrency = (r.currency as string) ?? null;
          }
          const at = r.observed_at as string;
          if (cur.lastAt == null || at > cur.lastAt) cur.lastAt = at;
          m.set(k, cur);
        }
        setMap(m);
      });
    return () => { cancelled = true; };
  }, [game, idsKey]);

  return map;
}
