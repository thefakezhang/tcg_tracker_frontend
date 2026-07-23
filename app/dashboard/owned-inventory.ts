"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type OwnedInventoryGame = "pokemon" | "mtg" | "pokemon_sealed";

export interface OwnedInventoryIdentity {
  game: OwnedInventoryGame;
  cardId?: string | number | null;
  productId?: string | number | null;
  sealedCondition?: string | null;
  variantEdition?: string | null;
}

export interface OwnedInventoryCountRow {
  game: OwnedInventoryGame;
  card_id: number | null;
  product_id: number | null;
  sealed_condition: string | null;
  variant_edition: string | null;
  qty_owned: number;
}

export function ownedInventoryKey(identity: OwnedInventoryIdentity): string {
  if (identity.game === "pokemon_sealed") {
    return [
      identity.game,
      identity.productId ?? "",
      identity.sealedCondition ?? "",
      identity.variantEdition ?? "",
    ].join(":");
  }
  return `${identity.game}:${identity.cardId ?? ""}`;
}

export function ownedInventoryCountMap(
  rows: OwnedInventoryCountRow[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = ownedInventoryKey({
      game: row.game,
      cardId: row.card_id,
      productId: row.product_id,
      sealedCondition: row.sealed_condition,
      variantEdition: row.variant_edition,
    });
    counts.set(key, Number(row.qty_owned));
  }
  return counts;
}

// One page causes one owned-count request.
// The database view already collapses all grades, conditions, legs, and FIFO
// layers for singles, while sealed identities retain their two visible axes.
export function useOwnedInventoryCounts(
  game: OwnedInventoryGame,
  identities: OwnedInventoryIdentity[],
): ReadonlyMap<string, number> {
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(new Map());
  const idColumn = game === "pokemon_sealed" ? "product_id" : "card_id";
  const ids = useMemo(
    () => [...new Set(
      identities
        .map((identity) =>
          game === "pokemon_sealed" ? identity.productId : identity.cardId
        )
        .filter((value): value is string | number => value != null),
    )].sort((a, b) => String(a).localeCompare(String(b))),
    [game, identities],
  );
  const idsKey = ids.join(",");

  useEffect(() => {
    let cancelled = false;
    if (ids.length === 0) {
      setCounts(new Map());
      return () => { cancelled = true; };
    }

    const supabase = createClient();
    void supabase
      .from("owned_inventory_counts_v")
      .select(
        "game, card_id, product_id, sealed_condition, variant_edition, qty_owned",
      )
      .eq("game", game)
      .in(idColumn, ids)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to load owned inventory counts:", error);
          setCounts(new Map());
          return;
        }
        setCounts(
          ownedInventoryCountMap(
            (data as OwnedInventoryCountRow[] | null) ?? [],
          ),
        );
      });

    return () => { cancelled = true; };
  }, [game, idColumn, idsKey]);

  return counts;
}
