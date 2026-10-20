// Turning the two baskets of a trade into a record_trade call.
//
// lib/trades.ts holds the money identity (value_in = value_out + cash). This
// holds the items, because the backend RPC takes them as two jsonb arrays and
// building those by hand in the component is how a payload drifts from what the
// RPC validates.
//
// WHY THE TWO SIDES ARE NOT SYMMETRIC. The outgoing side must be stock we
// actually hold, so it is picked from inventory and carries the condition the
// holding is in. The incoming side is cards we do not hold yet, so it is picked
// from the catalogue and the condition is a choice. That asymmetry is the whole
// difference between a sale and an acquisition, and flattening it would let you
// "give away" a card you never had.
//
// Per-item value is NOT collected. record_trade passes the lot's total to
// finalize_acquisition_lot, which splits it across the lines by market value,
// honouring a price_override_usd pin and the bulk rules. marketValueUsd is
// optional and only for a card the pricing engine cannot value - the operator
// proposing a number where the data has none.

export type TradeGame = "pokemon" | "mtg" | "pokemon_sealed";

/** A row in either basket, as the form holds it. */
export interface TradeItemDraft {
  /** Stable key for React and for de-duplication while editing. */
  key: string;
  game: TradeGame;
  /** Card id for singles; product id for sealed. */
  itemId: number;
  /** Null for sealed, which keys on sealed_condition/variant_edition instead. */
  conditionId: number | null;
  psaGrade: number;
  quantity: number;
  sealedCondition?: string | null;
  variantEdition?: string | null;
  /** Incoming side only, and only where the engine cannot price the card. */
  marketValueUsd?: number | null;
  /** For display; never sent. */
  label: string;
  /** Outgoing side only: how many we actually hold, so the form can cap qty. */
  available?: number;
}

export interface TradeItemPayload {
  game: TradeGame;
  kind?: "single" | "sealed";
  card_id?: number;
  product_id?: number;
  condition_id?: number;
  psa_grade?: number;
  quantity: number;
  sealed_condition?: string;
  variant_edition?: string;
  market_value_usd?: number;
}

function base(item: TradeItemDraft): TradeItemPayload {
  if (item.game === "pokemon_sealed") {
    return {
      game: "pokemon_sealed",
      kind: "sealed",
      product_id: item.itemId,
      quantity: item.quantity,
      sealed_condition: item.sealedCondition ?? "standard",
      variant_edition: item.variantEdition ?? "standard",
    };
  }
  return {
    game: item.game,
    kind: "single",
    card_id: item.itemId,
    condition_id: item.conditionId ?? undefined,
    psa_grade: item.psaGrade,
    quantity: item.quantity,
  };
}

/** The outgoing basket. No market value: the sale's gross is the agreed value. */
export function itemsOutPayload(items: TradeItemDraft[]): TradeItemPayload[] {
  return items.map(base);
}

/** The incoming basket, carrying an operator-proposed value where there is one. */
export function itemsInPayload(items: TradeItemDraft[]): TradeItemPayload[] {
  return items.map((item) => {
    const row = base(item);
    if (item.marketValueUsd != null && item.marketValueUsd > 0) {
      row.market_value_usd = item.marketValueUsd;
    }
    return row;
  });
}

export interface ItemProblem {
  key: string;
  reason: "quantity" | "oversold" | "condition";
}

/**
 * What is wrong with a basket, so the form can point at the row rather than
 * letting the RPC refuse the whole call. `requireHeld` is the outgoing side,
 * where quantity cannot exceed what we hold.
 */
export function itemProblems(items: TradeItemDraft[], requireHeld: boolean): ItemProblem[] {
  const out: ItemProblem[] = [];
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      out.push({ key: item.key, reason: "quantity" });
      continue;
    }
    if (requireHeld && item.available != null && item.quantity > item.available) {
      out.push({ key: item.key, reason: "oversold" });
      continue;
    }
    if (item.game !== "pokemon_sealed" && item.conditionId == null) {
      out.push({ key: item.key, reason: "condition" });
    }
  }
  return out;
}

/**
 * A trade needs cards on both sides and a balance that holds. Cash alone is not
 * a trade, and neither is a one-sided gift: for cards out for cash only, the
 * sale screen is the right place.
 */
export function canRecordTrade(args: {
  itemsOut: TradeItemDraft[];
  itemsIn: TradeItemDraft[];
  valueOutUsd: number | null;
  signedCashUsd: number;
}): boolean {
  if (args.itemsOut.length === 0 || args.itemsIn.length === 0) return false;
  if (args.valueOutUsd == null || !(args.valueOutUsd > 0)) return false;
  // value_in = value_out + cash, and the incoming cards must carry something.
  if (!(args.valueOutUsd + args.signedCashUsd > 0)) return false;
  if (itemProblems(args.itemsOut, true).length > 0) return false;
  if (itemProblems(args.itemsIn, false).length > 0) return false;
  return true;
}
