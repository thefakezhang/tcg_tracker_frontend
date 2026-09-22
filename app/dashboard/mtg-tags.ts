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
// to add another card. The other three come from edhrec.com play rates,
// refreshed weekly by refresh-edhrec-tags.

export type MtgTagDimension =
  | "reserved"
  | "cedhStaple"
  | "cedhExclusive"
  | "topCommander";

export type MtgTagColumn =
  | "is_reserved"
  | "is_cedh_staple"
  | "is_cedh_exclusive"
  | "is_top_commander";

const TAG_COLUMNS: Record<MtgTagDimension, MtgTagColumn> = {
  reserved: "is_reserved",
  cedhStaple: "is_cedh_staple",
  cedhExclusive: "is_cedh_exclusive",
  topCommander: "is_top_commander",
};

// Declaration order drives the order of the chips in the browser.
export const MTG_TAG_DIMENSIONS: readonly MtgTagDimension[] = [
  "reserved",
  "cedhStaple",
  "cedhExclusive",
  "topCommander",
];

export interface MtgTagFlags {
  is_reserved?: boolean | null;
  is_cedh_staple?: boolean | null;
  is_cedh_exclusive?: boolean | null;
  is_top_commander?: boolean | null;
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
