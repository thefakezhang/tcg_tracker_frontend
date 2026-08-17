"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { selectAllByIds } from "@/lib/supabase/select-all";

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
    // One card -> many sightings: page past the cap so a card's cheapest / latest
    // observation can't vanish once the trip log grows.
    void selectAllByIds<Record<string, unknown>>(
      ids, ["sighting_id"], (chunk) => supabase
        .from("trip_observations_v")
        .select("card_id, price_usd, observed_price, currency, observed_at")
        .in("card_id", chunk),
    ).then(
      (data) => {
        if (cancelled) return;
        const m = new Map<string, CardObservation>();
        for (const r of data) {
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
      },
      () => { if (!cancelled) setMap(new Map()); },
    );
    return () => { cancelled = true; };
  }, [game, idsKey]);

  return map;
}
