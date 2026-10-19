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

export type MtgTagDimension =
  | "reserved"
  | "cedhStaple"
  | "cedhExclusive"
  | "topCommander"
  | "commanderStockable";

export type MtgTagColumn =
  | "is_reserved"
  | "is_cedh_staple"
  | "is_cedh_exclusive"
  | "is_top_commander"
  | "is_commander_stockable";

const TAG_COLUMNS: Record<MtgTagDimension, MtgTagColumn> = {
  reserved: "is_reserved",
  cedhStaple: "is_cedh_staple",
  cedhExclusive: "is_cedh_exclusive",
  topCommander: "is_top_commander",
  commanderStockable: "is_commander_stockable",
};

// Declaration order drives the order of the chips in the browser.
export const MTG_TAG_DIMENSIONS: readonly MtgTagDimension[] = [
  "reserved",
  "cedhStaple",
  "cedhExclusive",
  "topCommander",
  "commanderStockable",
];

export interface MtgTagFlags {
  is_reserved?: boolean | null;
  is_cedh_staple?: boolean | null;
  is_cedh_exclusive?: boolean | null;
  is_top_commander?: boolean | null;
  is_commander_stockable?: boolean | null;
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
    || card.is_commander_stockable === true;
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
