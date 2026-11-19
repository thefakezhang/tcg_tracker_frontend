// MTG card-list tags: opt-in filters for cards that belong to a named set,
// the way japan-exclusivity.ts does for Pokemon artwork and stamps.
//
// Selecting several tags takes the UNION, matching the Japan-exclusivity
// selection behaviour: asking for two tags widens the list rather than
// narrowing it to their overlap, which is what "show me these as well" means
// when clicking a second chip.
//
// Adding a tag is one entry in TAG_COLUMNS plus the matching boolean column on
// mtg_card_definitions_v.
//
// Reserved List comes from MTGJSON, which the estate already syncs nightly and
// which needs no refresh cadence of its own - Wizards committed in 2010 never
// to add another card. The next three come from edhrec.com play rates,
// refreshed weekly by refresh-edhrec-tags.
//
// commanderStockable comes from a DIFFERENT job on a different cadence,
// refresh-edhrec-demand, which reads the top commanders' own pages rather than
// the ranking pages. It is a stocking signal rather than a format fact: enough
// Commander decks play the card, and enough printings of it are priced, that
// buying copies is a decision the data supports. The floors live in that
// command, not here and not in the schema, so they can be tuned without a
// migration (000564, 000566).
//
// The four format chips come from mtgtop8.com tournament results, refreshed
// weekly by refresh-mtgtop8-meta (backend migration 000664, #2770): a card is
// "played" in a format when enough of that format's last two months of decks
// run it, main deck or sideboard. Each format is its own measurement from its
// own page, so the evidence is one format_play object keyed by format code
// rather than one provenance group for all four.

export type MtgTagDimension =
  | "reserved"
  | "cedhStaple"
  | "cedhExclusive"
  | "topCommander"
  | "commanderStockable"
  | "standardPlayed"
  | "modernPlayed"
  | "legacyPlayed"
  | "cedhPlayed";

export type MtgTagColumn =
  | "is_reserved"
  | "is_cedh_staple"
  | "is_cedh_exclusive"
  | "is_top_commander"
  | "is_commander_stockable"
  | "is_standard_played"
  | "is_modern_played"
  | "is_legacy_played"
  | "is_cedh_played";

const TAG_COLUMNS: Record<MtgTagDimension, MtgTagColumn> = {
  reserved: "is_reserved",
  cedhStaple: "is_cedh_staple",
  cedhExclusive: "is_cedh_exclusive",
  topCommander: "is_top_commander",
  commanderStockable: "is_commander_stockable",
  standardPlayed: "is_standard_played",
  modernPlayed: "is_modern_played",
  legacyPlayed: "is_legacy_played",
  cedhPlayed: "is_cedh_played",
};

// Declaration order drives the order of the chips in the browser.
export const MTG_TAG_DIMENSIONS: readonly MtgTagDimension[] = [
  "reserved",
  "cedhStaple",
  "cedhExclusive",
  "topCommander",
  "commanderStockable",
  "standardPlayed",
  "modernPlayed",
  "legacyPlayed",
  "cedhPlayed",
];

export interface MtgTagFlags {
  is_reserved?: boolean | null;
  is_cedh_staple?: boolean | null;
  is_cedh_exclusive?: boolean | null;
  is_top_commander?: boolean | null;
  is_commander_stockable?: boolean | null;
  is_standard_played?: boolean | null;
  is_modern_played?: boolean | null;
  is_legacy_played?: boolean | null;
  is_cedh_played?: boolean | null;
}

// Provenance for the EDHREC-derived labels, one group per WRITER rather than
// one per label - which is the real unit, because refresh-edhrec-tags sets the
// three cEDH columns together from the ranking pages and refresh-edhrec-demand
// sets the stockable column from the commanders' pages, on its own cadence.
// Per-label evidence would imply an independence that does not exist
// (migration 000564).
//
// Every field is optional. The Reserved List tag has no provenance at all - it
// is a published policy, not a measurement - and a card tagged before 000564
// carries the boolean with all three of its provenance fields still null.
export interface MtgLabelProvenance {
  edhrec_tags_reason?: string | null;
  edhrec_tags_evidence_url?: string | null;
  edhrec_tags_as_of?: string | null;
  commander_demand_reason?: string | null;
  commander_demand_evidence_url?: string | null;
  commander_demand_as_of?: string | null;
  format_play?: MtgFormatPlayByCode | null;
}

// One format's evidence inside format_play, as refresh-mtgtop8-meta writes it.
// Shares are percentages of the format's decks in mtgtop8's "Last 2 Months"
// period; the *_2w fields are the same card in "Last 2 Weeks", which is what
// shows a card rising or falling inside a single crawl. jsonb_strip_nulls drops
// a board the card is not played on, so every numeric field is optional.
export interface MtgFormatPlay {
  format?: string;
  main_pct?: number;
  main_decks?: number;
  main_avg?: number;
  side_pct?: number;
  side_decks?: number;
  side_avg?: number;
  main_pct_2w?: number;
  side_pct_2w?: number;
  total_decks?: number;
  period?: string;
  url?: string;
  as_of?: string;
  reason?: string;
}

export type MtgFormatCode = "ST" | "MO" | "LE" | "cEDH";
export type MtgFormatPlayByCode = Partial<Record<MtgFormatCode, MtgFormatPlay>>;

export type MtgFormatPlayDimension = Extract<
  MtgTagDimension,
  "standardPlayed" | "modernPlayed" | "legacyPlayed" | "cedhPlayed"
>;

// Chip order, and the format code each label's evidence is keyed under.
export const FORMAT_PLAY_DIMENSIONS: readonly MtgFormatPlayDimension[] = [
  "standardPlayed",
  "modernPlayed",
  "legacyPlayed",
  "cedhPlayed",
];

export const FORMAT_PLAY_CODE: Record<MtgFormatPlayDimension, MtgFormatCode> = {
  standardPlayed: "ST",
  modernPlayed: "MO",
  legacyPlayed: "LE",
  cedhPlayed: "cEDH",
};

// Which way a format label is moving: "up" when the last two weeks run
// clearly ahead of the two-month share, "down" when clearly behind, otherwise
// null. Clearly means both a quarter relative and a full point absolute: a
// 1.2% card moving to 1.6% is noise in a two-week window of a few hundred
// decks, and a 40% staple moving to 42% is not news.
//
// It names the BOARD that moved and that board's two-week share, because the
// two boards can move in opposite directions and the text has to quote the
// one the arrow is about: Teferi, Time Raveler fell in Modern sideboards
// while rising in main decks, and the first version read "Falling: 18.6%",
// which was the main-deck share going up.
//
// recent is null when the card is absent from the two-week list, which means
// under the crawl floor rather than zero.
export interface FormatPlayTrend {
  direction: "up" | "down";
  board: "main" | "side";
  recent: number | null;
}

export function formatPlayTrend(play: MtgFormatPlay | null | undefined): FormatPlayTrend | null {
  if (!play) return null;
  const boards: { board: "main" | "side"; twoMonth?: number; twoWeek?: number }[] = [
    { board: "main", twoMonth: play.main_pct, twoWeek: play.main_pct_2w },
    { board: "side", twoMonth: play.side_pct, twoWeek: play.side_pct_2w },
  ];
  let best: FormatPlayTrend | null = null;
  let bestDelta = 0;
  for (const { board, twoMonth, twoWeek } of boards) {
    if (twoMonth == null) continue;
    const delta = (twoWeek ?? 0) - twoMonth;
    if (Math.abs(delta) < 1 || Math.abs(delta) < twoMonth * 0.25) continue;
    if (Math.abs(delta) > Math.abs(bestDelta)) {
      bestDelta = delta;
      best = { direction: delta > 0 ? "up" : "down", board, recent: twoWeek ?? null };
    }
  }
  return best;
}

// The three tags one EDHREC refresh writes together, in chip order. Exported
// so the evidence panel names the active tags in the same order the filter
// chips appear in, rather than in whatever order a reader's eye lands on.
//
// Narrowed to its own subtype rather than typed as MtgTagDimension[], so the
// evidence panel's `mtgLabel.${dimension}` key is exactly these three and a
// fourth tag cannot be added here without its badge label.
export type MtgEdhrecTagDimension = Extract<
  MtgTagDimension,
  "cedhStaple" | "cedhExclusive" | "topCommander"
>;

export const EDHREC_TAG_DIMENSIONS: readonly MtgEdhrecTagDimension[] = [
  "cedhStaple",
  "cedhExclusive",
  "topCommander",
];

export function hasAnyMtgLabel(card: MtgTagFlags): boolean {
  return EDHREC_TAG_DIMENSIONS.some((d) => card[mtgTagColumn(d)] === true)
    || card.is_commander_stockable === true
    || FORMAT_PLAY_DIMENSIONS.some((d) => card[mtgTagColumn(d)] === true);
}

export interface MtgTagQueryFilter {
  /** Columns that must each be true; used when exactly one tag is selected. */
  equalsTrue: MtgTagColumn[];
  /** Columns where any being true qualifies; used for a union of several. */
  anyOfTrue: MtgTagColumn[];
}

export function mtgTagColumn(dimension: MtgTagDimension): MtgTagColumn {
  return TAG_COLUMNS[dimension];
}

export function mtgTagSelectionQueryFilter(
  selected: ReadonlySet<MtgTagDimension>,
): MtgTagQueryFilter {
  const columns = [...selected].map(mtgTagColumn);
  if (columns.length === 0) return { equalsTrue: [], anyOfTrue: [] };
  // A single tag becomes an eq() so PostgREST can use the partial index
  // directly; an or() over one column would not.
  if (columns.length === 1) return { equalsTrue: columns, anyOfTrue: [] };
  return { equalsTrue: [], anyOfTrue: columns };
}

export function matchesMtgTagSelection(
  card: MtgTagFlags,
  selected: ReadonlySet<MtgTagDimension>,
): boolean {
  if (selected.size === 0) return true;
  return [...selected].some((dimension) => card[mtgTagColumn(dimension)] === true);
}
