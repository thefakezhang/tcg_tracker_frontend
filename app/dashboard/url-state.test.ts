import { describe, expect, it } from "vitest";
import { buildDashboardSearch, parseDashboardSearch } from "./url-state";
import { parseShopParam } from "./url-params";
import { MATCH_REVIEW_SENTINEL } from "./ReviewQueueNavigationContext";

const ARRIVALS = -21;

describe("dashboard URL codec", () => {
  it("round-trips every state shape", () => {
    const cases = [
      { game: "pokemon", activeTripId: null, activeBuylistId: null, tab: null, shop: null },
      { game: "mtg", activeTripId: null, activeBuylistId: null, tab: null, shop: null },
      { game: "pokemon_sealed", activeTripId: null, activeBuylistId: null, tab: null, shop: null },
      { game: "pokemon", activeTripId: -7, activeBuylistId: null, tab: null, shop: null }, // customers
      { game: "pokemon", activeTripId: 0, activeBuylistId: null, tab: null, shop: null }, // trips overview
      { game: "pokemon", activeTripId: MATCH_REVIEW_SENTINEL, activeBuylistId: null, tab: null, shop: null },
      { game: "mtg", activeTripId: 4, activeBuylistId: null, tab: "sales", shop: null },
      { game: "pokemon", activeTripId: 4, activeBuylistId: null, tab: null, shop: null },
      { game: "pokemon", activeTripId: null, activeBuylistId: 2, tab: null, shop: null },
      { game: "pokemon", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: null },
      { game: "mtg", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: "alice" },
    ] as const;
    for (const c of cases) {
      const search = buildDashboardSearch(c);
      expect(parseDashboardSearch(search)).toEqual(c);
    }
  });
  it("uses human-readable slugs, not sentinel numbers", () => {
    expect(buildDashboardSearch({ game: "pokemon", activeTripId: -7, activeBuylistId: null, tab: null, shop: null })).toBe("?view=customers");
    expect(buildDashboardSearch({ game: "mtg", activeTripId: 4, activeBuylistId: null, tab: "sales", shop: null })).toBe("?game=mtg&trip=4&tab=sales");
    expect(buildDashboardSearch({ game: "pokemon", activeTripId: null, activeBuylistId: null, tab: null, shop: null })).toBe("");
  });
  it("falls back to browse on unknown or malformed params", () => {
    const browse = { game: "pokemon", activeTripId: null, activeBuylistId: null, tab: null, shop: null };
    expect(parseDashboardSearch("?view=nope")).toEqual(browse);
    expect(parseDashboardSearch("?trip=abc")).toEqual(browse);
    expect(parseDashboardSearch("?trip=-3")).toEqual(browse);
    expect(parseDashboardSearch("?game=yugioh")).toEqual(browse);
    expect(parseDashboardSearch("?trip=4&tab=<script>")).toEqual({ ...browse, activeTripId: 4 });
  });
  it("gives a view precedence over trip and buylist when several are present", () => {
    expect(parseDashboardSearch("?view=sales&trip=4&buylist=2").activeTripId).toBe(-2);
  });
  it("carries the arrivals shop only with the arrivals view", () => {
    expect(buildDashboardSearch({ game: "pokemon", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: "alice" })).toBe("?view=arrivals&shop=alice");
    expect(parseDashboardSearch("?view=arrivals&shop=alice")).toEqual({ game: "pokemon", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: "alice" });
    // A shop on another view, or with no view, is noise.
    expect(parseDashboardSearch("?view=customers&shop=alice").shop).toBeNull();
    expect(parseDashboardSearch("?shop=alice").shop).toBeNull();
    expect(buildDashboardSearch({ game: "pokemon", activeTripId: -7, activeBuylistId: null, tab: null, shop: "alice" })).toBe("?view=customers");
    // The same bound the API route enforces on buyer_handle.
    expect(parseDashboardSearch(`?view=arrivals&shop=${"a".repeat(101)}`).shop).toBeNull();
    expect(parseDashboardSearch("?view=arrivals&shop=%00alice").shop).toBeNull();
    expect(parseDashboardSearch("?view=arrivals&shop=").shop).toBeNull();
  });
  it("validates a shop handle the way the route does", () => {
    expect(parseShopParam(" alice ")).toBe("alice");
    expect(parseShopParam("")).toBeNull();
    expect(parseShopParam(null)).toBeNull();
    expect(parseShopParam("a".repeat(100))).toBe("a".repeat(100));
    expect(parseShopParam("a".repeat(101))).toBeNull();
    expect(parseShopParam("bad\u0007handle")).toBeNull();
  });
});
