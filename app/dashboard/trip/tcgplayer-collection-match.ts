// Pure matcher: resolve a parsed TCGplayer collection row to one of the seller's
// existing inventory holdings. We only ever sell what we hold, and the holdings
// already carry set code / card number / name, so matching against them avoids
// any fragile TCGplayer-to-catalog identity mapping. Identity keys on the card
// number first (per docs/matching.md), with the name only breaking ties - never
// the other way around.
import type { TcgCollectionRow } from "./tcgplayer-collection-csv";

export type CollectionMatchStatus = "matched" | "ambiguous" | "none";

export interface MatchableHolding {
  key: string; // holdingKey (stable identity used by the sell dialog)
  card_id: number | null;
  set_code: string;
  card_number: string | null;
  name: string;
  englishName: string | null;
  leg: string;
  qty_on_hand: number;
}

export interface CollectionMatch {
  status: CollectionMatchStatus;
  holding: MatchableHolding | null;
  candidates: MatchableHolding[]; // all number-matches, for the operator to disambiguate
}

// The comparable core of a card number: the part before a "/", lowercased with
// leading zeros stripped, so "006", "6", and "6/102" all reduce to "6" and
// "052/SV-P" to "52". Empty string never matches anything.
export function numberCore(raw: string | null | undefined): string {
  if (!raw) return "";
  const head = raw.trim().toLowerCase().split("/")[0].replace(/\s+/g, "");
  const stripped = head.replace(/^0+(?=\d)/, "");
  return stripped;
}

function nameTokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 1);
}

// A loose name agreement: any shared token between the CSV name and a holding's
// name (regional or English). Used only to break a multi-holding number tie.
function nameAgrees(row: TcgCollectionRow, h: MatchableHolding): boolean {
  const rowTokens = new Set(nameTokens(row.name));
  if (rowTokens.size === 0) return false;
  const hay = nameTokens([h.name, h.englishName ?? ""].join(" "));
  return hay.some((t) => rowTokens.has(t));
}

export function matchCollectionRow(row: TcgCollectionRow, holdings: readonly MatchableHolding[]): CollectionMatch {
  const core = numberCore(row.number);
  if (core === "") return { status: "none", holding: null, candidates: [] };
  const candidates = holdings.filter((h) => h.qty_on_hand > 0 && numberCore(h.card_number) === core);
  if (candidates.length === 0) return { status: "none", holding: null, candidates: [] };
  if (candidates.length === 1) return { status: "matched", holding: candidates[0], candidates };
  // Multiple holdings share the number - narrow by name agreement.
  const byName = candidates.filter((h) => nameAgrees(row, h));
  if (byName.length === 1) return { status: "matched", holding: byName[0], candidates };
  return { status: "ambiguous", holding: null, candidates };
}
