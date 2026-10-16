import { describe, expect, it } from "vitest";
import { listingCols, LISTINGS_TABLE_MAP } from "./use-card-data";

// available_quantity exists only on pokemon_market_listings (migration 000408).
// PostgREST rejects the entire query when a selected column is missing, so
// asking for it against mtg_market_listings returned
// "column mtg_market_listings.available_quantity does not exist" and the card
// detail modal rendered zero listings for every MTG card.
describe("listingCols", () => {
  it("omits available_quantity for MTG, whose table does not have it", () => {
    expect(listingCols("mtg")).not.toContain("available_quantity");
  });

  it("omits available_quantity for sealed, whose table does not have it", () => {
    expect(listingCols("pokemon_sealed")).not.toContain("available_quantity");
  });

  it("requests available_quantity for Pokemon singles, which do have it", () => {
    expect(listingCols("pokemon")).toContain("available_quantity");
  });

  // Same failure mode, different column. 000559 put price_p25/price_p75 on both
  // CARD listing tables and deliberately not on the sealed one, so selecting
  // them for sealed would make PostgREST refuse the whole query and the sealed
  // modal would show no listings at all rather than no spread bar.
  it("omits the price spread for sealed, whose table does not have it", () => {
    expect(listingCols("pokemon_sealed")).not.toContain("price_p25");
    expect(listingCols("pokemon_sealed")).not.toContain("price_p75");
  });

  it.each(["pokemon", "mtg"] as const)(
    "requests the price spread for %s, whose table has it",
    (game) => {
      expect(listingCols(game)).toContain("price_p25");
      expect(listingCols(game)).toContain("price_p75");
    },
  );

  it("selects the columns every listings table shares, for every game", () => {
    const shared = [
      "card_id",
      "price_type",
      "price_kind",
      "price",
      "currency",
      "psa_grade",
      "condition",
      "location_id",
      "listing_url",
      "last_updated",
      "currencies(symbol)",
    ];
    for (const game of Object.keys(LISTINGS_TABLE_MAP) as Array<
      keyof typeof LISTINGS_TABLE_MAP
    >) {
      for (const column of shared) {
        expect(listingCols(game)).toContain(column);
      }
    }
  });

  it("emits a valid column list with no empty entries", () => {
    for (const game of Object.keys(LISTINGS_TABLE_MAP) as Array<
      keyof typeof LISTINGS_TABLE_MAP
    >) {
      const parts = listingCols(game).split(",").map((p) => p.trim());
      expect(parts.every((p) => p.length > 0)).toBe(true);
    }
  });
});
