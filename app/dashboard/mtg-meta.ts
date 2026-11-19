// Shaping for the MTG Meta view (backend migration 000664, #2770).
//
// The two read views already put the two-month share, the two-week share and
// the previous crawl's two-month share on one row, so everything here is pure:
// which rows a filter keeps, how a row sorts, and which way a share is moving.

import type { MtgFormatCode } from "./mtg-tags";

export const META_FORMATS: readonly { code: MtgFormatCode; labelKey: MetaFormatLabelKey }[] = [
  { code: "ST", labelKey: "mtgLabel.standardPlayed" },
  { code: "MO", labelKey: "mtgLabel.modernPlayed" },
  { code: "LE", labelKey: "mtgLabel.legacyPlayed" },
  { code: "cEDH", labelKey: "mtgLabel.cedhPlayed" },
];

export type MetaFormatLabelKey =
  | "mtgLabel.standardPlayed"
  | "mtgLabel.modernPlayed"
  | "mtgLabel.legacyPlayed"
  | "mtgLabel.cedhPlayed";

// One row of mtg_format_archetypes_v. Numeric columns arrive from PostgREST as
// numbers (numeric(4,1)) or null.
export interface MetaArchetypeRow {
  format_code: string;
  format_name: string;
  archetype_id: number;
  archetype_name: string;
  macro_class: string;
  rank: number;
  share_2m: number;
  share_2w: number | null;
  share_2m_prior: number | null;
  trend: string | null;
  decks_2m: number;
  decks_2w: number | null;
  observed_at: string;
  prior_observed_at: string | null;
  evidence_url: string;
}

// One row of mtg_format_card_play_v. A card present only in the last two weeks
// (a new set's breakout) has no two-month share.
export interface MetaCardRow {
  format_code: string;
  format_name: string;
  board: "MD" | "SB";
  card_name: string;
  catalog_key: string;
  rank_2m: number | null;
  share_2m: number | null;
  decks_2m: number | null;
  avg_2m: number | null;
  rank_2w: number | null;
  share_2w: number | null;
  avg_2w: number | null;
  share_2m_prior: number | null;
  total_decks_2m: number;
  observed_at: string;
  in_catalog: boolean | null;
  median_sell_usd: number | null;
  priced_printings: number | null;
  evidence_url: string;
}

export const META_ARCHETYPE_COLS =
  "format_code, format_name, archetype_id, archetype_name, macro_class, rank, share_2m, share_2w, share_2m_prior, trend, decks_2m, decks_2w, observed_at, prior_observed_at, evidence_url";
export const META_CARD_COLS =
  "format_code, format_name, board, card_name, catalog_key, rank_2m, share_2m, decks_2m, avg_2m, rank_2w, share_2w, avg_2w, share_2m_prior, total_decks_2m, observed_at, in_catalog, median_sell_usd, priced_printings, evidence_url";

export type MetaDirection = "up" | "down" | "new" | null;

// The same rule as formatPlayTrend: a quarter relative and a full point
// absolute, so a card moving within noise reads as steady. "new" is a card
// with a two-week share and none over two months.
export function metaDirection(twoMonth: number | null, twoWeek: number | null): MetaDirection {
  if (twoMonth == null) return twoWeek != null ? "new" : null;
  const delta = (twoWeek ?? 0) - twoMonth;
  if (Math.abs(delta) < 1 || Math.abs(delta) < twoMonth * 0.25) return null;
  return delta > 0 ? "up" : "down";
}

// Change in two-month share since the previous weekly crawl, or null when
// there is no previous crawl or the card was not in it.
export function weekChange(current: number | null, prior: number | null): number | null {
  if (current == null || prior == null) return null;
  return Math.round((current - prior) * 10) / 10;
}

export type MetaCardSort = "share" | "recent" | "price";

export function filterMetaCards(
  rows: readonly MetaCardRow[],
  opts: { board: "MD" | "SB"; search: string; risingOnly: boolean; sort: MetaCardSort },
): MetaCardRow[] {
  const term = opts.search.trim().toLowerCase();
  const kept = rows.filter((row) => {
    if (row.board !== opts.board) return false;
    if (term && !row.card_name.toLowerCase().includes(term)) return false;
    if (opts.risingOnly) {
      const dir = metaDirection(row.share_2m, row.share_2w);
      if (dir !== "up" && dir !== "new") return false;
    }
    return true;
  });
  const key = (row: MetaCardRow): number => {
    if (opts.sort === "recent") return row.share_2w ?? -1;
    if (opts.sort === "price") return row.median_sell_usd ?? -1;
    return row.share_2m ?? -1;
  };
  // Ties break on name so the order is stable across refetches.
  return kept.sort((a, b) => key(b) - key(a) || a.card_name.localeCompare(b.card_name));
}
