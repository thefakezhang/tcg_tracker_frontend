// MTG card-list tags: opt-in filters for cards that belong to a named set,
// the way japan-exclusivity.ts does for Pokemon artwork and stamps.
//
// Selecting several tags takes the UNION, matching the Japan-exclusivity
// selection behaviour: asking for two tags widens the list rather than
// narrowing it to their overlap, which is what "show me these as well" means
// when clicking a second chip.
//
// Adding a tag is one entry in TAG_COLUMNS plus the matching boolean column on
// mtg_card_definitions_v. Reserved List is first because MTGJSON already ships
// the flag with AllPrintings, which the estate syncs nightly. The cEDH and
// commander tags need a play-rate source that does not exist yet.

export type MtgTagDimension = "reserved";

export type MtgTagColumn = "is_reserved";

const TAG_COLUMNS: Record<MtgTagDimension, MtgTagColumn> = {
  reserved: "is_reserved",
};

export interface MtgTagFlags {
  is_reserved?: boolean | null;
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
