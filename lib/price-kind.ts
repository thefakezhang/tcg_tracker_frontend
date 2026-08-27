import type { TranslationKey } from "@/lib/i18n";

// What a price IS, from the operator's side. Mirrors the backend's
// price_kind_enum (migration 000355), derived per source by
// price_kind_for_source() and carried on every market listing and on both
// sides of every price summary (best_buy_kind / best_sell_kind, 000363).
//
//   sold      - a completed transaction, or a statistic over completed ones:
//               evidence of what you would realize, gross of selling fees
//   bid       - a standing offer to buy from you (a buylist quote): what you
//               receive, already net
//   ask       - a live listing you can purchase: what you pay to acquire
//   valuation - a third party's estimate; nobody transacted
export type PriceKind = "sold" | "bid" | "ask" | "valuation";

export const PRICE_KINDS: readonly PriceKind[] = [
  "sold",
  "bid",
  "ask",
  "valuation",
];

export function isPriceKind(value: unknown): value is PriceKind {
  return (
    typeof value === "string" && (PRICE_KINDS as readonly string[]).includes(value)
  );
}

// The one-word marker shown beside a price so the operator can tell a real
// sale from an offer from an estimate at a glance. An ask carries no marker:
// the acquisition side is unambiguous in context, and "what I would pay" never
// needs qualifying. Unknown / unclassified kinds also show nothing rather than
// a wrong word.
export function priceKindMarkerKey(
  kind: PriceKind | null | undefined,
): TranslationKey | null {
  switch (kind) {
    case "sold":
      return "priceKind.sold";
    case "bid":
      return "priceKind.bid";
    case "valuation":
      return "priceKind.valuation";
    default:
      return null;
  }
}

// The longer explanation used as the marker's tooltip.
export function priceKindTitleKey(
  kind: PriceKind | null | undefined,
): TranslationKey | null {
  switch (kind) {
    case "sold":
      return "priceKind.sold.title";
    case "bid":
      return "priceKind.bid.title";
    case "valuation":
      return "priceKind.valuation.title";
    default:
      return null;
  }
}
