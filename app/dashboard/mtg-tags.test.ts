import { describe, expect, it } from "vitest";
import {
  hasAnyMtgLabel,
  matchesMtgTagSelection,
  mtgTagSelectionQueryFilter,
  type MtgTagDimension,
} from "./mtg-tags";

const none = new Set<MtgTagDimension>();
const reserved = new Set<MtgTagDimension>(["reserved"]);
const twoTags = new Set<MtgTagDimension>(["cedhStaple", "cedhExclusive"]);

describe("mtgTagSelectionQueryFilter", () => {
  it("adds no predicate when nothing is selected", () => {
    expect(mtgTagSelectionQueryFilter(none)).toEqual({ equalsTrue: [], anyOfTrue: [] });
  });

  // A single tag has to be an eq() rather than a one-armed or(): the partial
  // index on mtg_universal_cards only answers the equality form, and the list
  // is the surface that already timed out once under a lateral join (#1462).
  it("uses an equality for a single tag so the partial index applies", () => {
    expect(mtgTagSelectionQueryFilter(reserved)).toEqual({
      equalsTrue: ["is_reserved"],
      anyOfTrue: [],
    });
  });
});

describe("multiple tags", () => {
  // Selecting a second chip means "show me these as well". Intersecting would
  // make the list shrink as you click, which is the opposite of what the
  // Pokemon exclusivity chips do.
  it("takes the union rather than the intersection", () => {
    expect(mtgTagSelectionQueryFilter(twoTags)).toEqual({
      equalsTrue: [],
      anyOfTrue: ["is_cedh_staple", "is_cedh_exclusive"],
    });
  });

  it("keeps a card carrying either tag", () => {
    expect(matchesMtgTagSelection({ is_cedh_staple: true }, twoTags)).toBe(true);
    expect(matchesMtgTagSelection({ is_cedh_exclusive: true }, twoTags)).toBe(true);
    expect(matchesMtgTagSelection({ is_reserved: true }, twoTags)).toBe(false);
  });
});

describe("matchesMtgTagSelection", () => {
  it("keeps every card when nothing is selected", () => {
    expect(matchesMtgTagSelection({ is_reserved: false }, none)).toBe(true);
  });

  it("keeps a reserved card when the tag is selected", () => {
    expect(matchesMtgTagSelection({ is_reserved: true }, reserved)).toBe(true);
  });

  it("drops an unreserved card when the tag is selected", () => {
    expect(matchesMtgTagSelection({ is_reserved: false }, reserved)).toBe(false);
  });

  // The column is NOT NULL in the database, but a card object can reach this
  // from a projection that omitted it; absent must not read as a match, or the
  // list would claim cards are on the Reserved List when nothing said so.
  it("treats an absent flag as not reserved", () => {
    expect(matchesMtgTagSelection({}, reserved)).toBe(false);
    expect(matchesMtgTagSelection({ is_reserved: null }, reserved)).toBe(false);
  });
});

describe("commanderStockable", () => {
  const stockable = new Set<MtgTagDimension>(["commanderStockable"]);

  it("filters on the column the demand job writes", () => {
    expect(mtgTagSelectionQueryFilter(stockable)).toEqual({
      equalsTrue: ["is_commander_stockable"],
      anyOfTrue: [],
    });
  });

  // The label comes from a different job than the three cEDH tags, but it is
  // still a tag: a second chip widens the list.
  it("unions with a cEDH tag rather than intersecting it", () => {
    const both = new Set<MtgTagDimension>(["cedhStaple", "commanderStockable"]);
    expect(mtgTagSelectionQueryFilter(both)).toEqual({
      equalsTrue: [],
      anyOfTrue: ["is_cedh_staple", "is_commander_stockable"],
    });
    expect(matchesMtgTagSelection({ is_commander_stockable: true }, both)).toBe(true);
    expect(matchesMtgTagSelection({ is_cedh_staple: true }, both)).toBe(true);
    expect(matchesMtgTagSelection({ is_top_commander: true }, both)).toBe(false);
  });

  it("treats an absent flag as not stockable", () => {
    expect(matchesMtgTagSelection({}, stockable)).toBe(false);
    expect(matchesMtgTagSelection({ is_commander_stockable: null }, stockable)).toBe(false);
  });
});

describe("hasAnyMtgLabel", () => {
  // The Reserved List is a published Wizards policy, not an EDHREC
  // measurement: it has no reason, no evidence URL and no date, so it must not
  // make the evidence panel appear with "measured before the evidence was
  // recorded" under it.
  it("ignores the Reserved List", () => {
    expect(hasAnyMtgLabel({ is_reserved: true })).toBe(false);
  });

  it("is true for any EDHREC label", () => {
    expect(hasAnyMtgLabel({ is_cedh_staple: true })).toBe(true);
    expect(hasAnyMtgLabel({ is_cedh_exclusive: true })).toBe(true);
    expect(hasAnyMtgLabel({ is_top_commander: true })).toBe(true);
    expect(hasAnyMtgLabel({ is_commander_stockable: true })).toBe(true);
  });

  it("is false for an unlabelled card", () => {
    expect(hasAnyMtgLabel({})).toBe(false);
    expect(hasAnyMtgLabel({ is_cedh_staple: false, is_commander_stockable: null })).toBe(false);
  });
});
