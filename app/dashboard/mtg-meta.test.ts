import { describe, expect, it } from "vitest";
import { filterMetaCards, metaDirection, weekChange, type MetaCardRow } from "./mtg-meta";

function row(over: Partial<MetaCardRow>): MetaCardRow {
  return {
    format_code: "MO", format_name: "Modern", board: "MD", card_name: "Card", catalog_key: "CARD",
    rank_2m: 1, share_2m: 10, decks_2m: 300, avg_2m: 4, rank_2w: 1, share_2w: 10, avg_2w: 4,
    share_2m_prior: 10, total_decks_2m: 3000, observed_at: "2026-11-22T10:00:00Z", in_catalog: true,
    us_low_ask_usd: 5, us_ask_printings: 3, us_low_ask_location: "tcgplayer", evidence_url: "https://www.mtgtop8.com/topcards?f=MO&meta=51",
    ...over,
  };
}

describe("metaDirection", () => {
  it("calls a move only when it is a quarter relative and a point absolute", () => {
    expect(metaDirection(10, 13)).toBe("up");
    expect(metaDirection(10, 12)).toBeNull(); // 20% relative
    expect(metaDirection(2, 2.8)).toBeNull(); // under a point
    expect(metaDirection(40, 29)).toBe("down");
  });
  it("reads a card absent from the two-month list as new, and a card absent from the last two weeks as falling", () => {
    expect(metaDirection(null, 3)).toBe("new");
    expect(metaDirection(5, null)).toBe("down");
    expect(metaDirection(null, null)).toBeNull();
  });
});

describe("weekChange", () => {
  it("rounds to the one decimal the source prints", () => {
    expect(weekChange(33.3, 30.0)).toBe(3.3);
    expect(weekChange(30, null)).toBeNull();
  });
});

describe("filterMetaCards", () => {
  const rows = [
    row({ card_name: "Arid Mesa", share_2m: 33.3, share_2w: 35, us_low_ask_usd: 30 }),
    row({ card_name: "Breakout", share_2m: null, share_2w: 6, us_low_ask_usd: 2 }),
    row({ card_name: "Riser", share_2m: 4, share_2w: 9, us_low_ask_usd: 12 }),
    row({ card_name: "Side Card", board: "SB", share_2m: 12 }),
  ];
  it("keeps one board, sorted by two-month share with two-week-only cards last", () => {
    expect(filterMetaCards(rows, { board: "MD", search: "", risingOnly: false, sort: "share" }).map((r) => r.card_name))
      .toEqual(["Arid Mesa", "Riser", "Breakout"]);
  });
  it("rising-only keeps the risers and the new cards", () => {
    expect(filterMetaCards(rows, { board: "MD", search: "", risingOnly: true, sort: "recent" }).map((r) => r.card_name))
      .toEqual(["Riser", "Breakout"]);
  });
  it("searches by name and sorts by price", () => {
    expect(filterMetaCards(rows, { board: "MD", search: "S", risingOnly: false, sort: "price" }).map((r) => r.card_name))
      .toEqual(["Arid Mesa", "Riser"]);
  });
});
