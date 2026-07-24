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
  qty_incoming: number;
}

// qty_owned counts finalized on-hand copies (FIFO qty_remaining); qty_incoming
// counts copies sitting on DRAFT acquisition lots - recorded mid-trip but not
// finalized, which is exactly the state the in-shop dupe check must see.
export interface OwnedInventoryCounts {
  owned: number;
  incoming: number;
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
): ReadonlyMap<string, OwnedInventoryCounts> {
  const counts = new Map<string, OwnedInventoryCounts>();
  for (const row of rows) {
    const key = ownedInventoryKey({
      game: row.game,
      cardId: row.card_id,
      productId: row.product_id,
      sealedCondition: row.sealed_condition,
      variantEdition: row.variant_edition,
    });
    counts.set(key, {
      owned: Number(row.qty_owned),
      incoming: Number(row.qty_incoming),
    });
  }
  return counts;
}

// Lot writes happen in other components (LotManager, AddToLotPopover, sales),
// so displayed counts go stale the moment a line lands. A tiny external store
// lets any writer bump every mounted hook into a refetch without threading
// callbacks through the component tree.
const ownedInventoryListeners = new Set<() => void>();

export function bumpOwnedInventory(): void {
  for (const listener of ownedInventoryListeners) listener();
}

export function useOwnedInventoryVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((value) => value + 1);
    ownedInventoryListeners.add(listener);
    return () => {
      ownedInventoryListeners.delete(listener);
    };
  }, []);
  return version;
}

// One page causes one owned-count request.
// The database view already collapses all grades, conditions, legs, and FIFO
// layers for singles, while sealed identities retain their two visible axes.
export function useOwnedInventoryCounts(
  game: OwnedInventoryGame,
  identities: OwnedInventoryIdentity[],
): ReadonlyMap<string, OwnedInventoryCounts> {
  const [counts, setCounts] = useState<ReadonlyMap<string, OwnedInventoryCounts>>(new Map());
  const version = useOwnedInventoryVersion();
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
        "game, card_id, product_id, sealed_condition, variant_edition, qty_owned, qty_incoming",
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, idColumn, idsKey, version]);

  return counts;
}
