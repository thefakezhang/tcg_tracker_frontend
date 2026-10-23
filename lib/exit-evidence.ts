import type { TranslationKey } from "@/lib/i18n";

// WHY an exit price is the number it is. Mirrors the backend's
// exit_evidence_enum (migration 000597), written by aggregate-prices onto
// best_buy_evidence.
//
// This is a different question from PriceKind, and the distinction is the
// point. A kind says WHAT a number is (a sale, an offer, an estimate). The
// evidence says whether we have grounds to believe it is still true.
//
//   bid              someone has committed to pay this. Needs nothing further:
//                    the quote IS the buyer.
//   sale_measured    a completed sale backed by evidence it still trades - a
//                    comp spread, or recent sales clearing the supply.
//   sale_unmeasured  a completed sale with no such evidence. Still the best
//                    available figure for that card, so it is NOT hidden; it
//                    simply must not look like the two above.
//   estimate         a third party's valuation. Nobody transacted.
//   unclassified     the source has no price_kind, so the row cannot reach a
//                    decision at all.
export type ExitEvidence =
  | "bid"
  | "sale_measured"
  | "sale_unmeasured"
  | "estimate"
  | "unclassified";

export const EXIT_EVIDENCE: readonly ExitEvidence[] = [
  "bid",
  "sale_measured",
  "sale_unmeasured",
  "estimate",
  "unclassified",
];

// The values an exit may have and still be worth acting on. Used by the
// browse filter, and keyed on the evidence rather than a list of sources so a
// new feed is judged the day it lands.
export const MEASURED_EXIT_EVIDENCE: readonly ExitEvidence[] = [
  "bid",
  "sale_measured",
];

export function isExitEvidence(value: unknown): value is ExitEvidence {
  return (
    typeof value === "string" &&
    (EXIT_EVIDENCE as readonly string[]).includes(value)
  );
}

// NULL is not "fine". The column is written by aggregate-prices, so a null
// means that pass has not run since migration 000597 - and a figure whose
// provenance we have not computed must not be presented as one we have.
// Treating null as unmeasured is the fail-closed reading.
export function exitIsMeasured(
  evidence: ExitEvidence | null | undefined,
): boolean {
  return evidence === "bid" || evidence === "sale_measured";
}

// The marker shown beside an exit price when it needs qualifying.
//
// Only the unmeasured case gets one. `bid` and `sale_measured` already carry
// the PriceKind marker, and adding a second badge saying "this one is fine"
// to 243,002 of 321,281 rows would be noise that trains the eye to ignore
// badges - which is how the operator stops seeing the one that matters.
// `estimate` is already marked by its kind.
export function exitEvidenceMarkerKey(
  evidence: ExitEvidence | null | undefined,
): TranslationKey | null {
  if (evidence === "sale_unmeasured") return "exitEvidence.unmeasured";
  return null;
}

// The provenance behind an unmeasured exit, which is the difference between
// "do not trust this" and "last sold on this day, this many copies".
//
// 56% of unmeasured exits DID sell something in the last 30 days and merely
// fell under the liquidity bar; the rest sold nothing, and saying so is the
// honest answer rather than silence. Returns the key and its parameters so the
// caller can interpolate through useTranslation.
export function exitEvidenceDetail(
  evidence: ExitEvidence | null | undefined,
  lastSaleDate: string | null | undefined,
  qty30d: number | null | undefined,
): { key: TranslationKey; params?: Record<string, string | number> } | null {
  if (evidence !== "sale_unmeasured") return null;
  if (lastSaleDate) {
    return {
      key: "exitEvidence.unmeasured.lastSold",
      params: { date: lastSaleDate, qty: qty30d ?? 0 },
    };
  }
  return { key: "exitEvidence.unmeasured.noSale" };
}
