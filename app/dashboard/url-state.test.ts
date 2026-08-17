import { describe, expect, it } from "vitest";
import { buildDashboardSearch, parseDashboardSearch } from "./url-state";
import { MATCH_REVIEW_SENTINEL } from "./ReviewQueueNavigationContext";

describe("dashboard URL codec", () => {
  it("round-trips every state shape", () => {
    const cases = [
      { game: "pokemon", activeTripId: null, activeBuylistId: null, tab: null },
      { game: "mtg", activeTripId: null, activeBuylistId: null, tab: null },
      { game: "pokemon_sealed", activeTripId: null, activeBuylistId: null, tab: null },
      { game: "pokemon", activeTripId: -7, activeBuylistId: null, tab: null }, // customers
      { game: "pokemon", activeTripId: 0, activeBuylistId: null, tab: null }, // trips overview
      { game: "pokemon", activeTripId: MATCH_REVIEW_SENTINEL, activeBuylistId: null, tab: null },
      { game: "mtg", activeTripId: 4, activeBuylistId: null, tab: "sales" },
      { game: "pokemon", activeTripId: 4, activeBuylistId: null, tab: null },
      { game: "pokemon", activeTripId: null, activeBuylistId: 2, tab: null },
    ] as const;
    for (const c of cases) {
      const search = buildDashboardSearch(c);
      expect(parseDashboardSearch(search)).toEqual(c);
    }
  });
  it("uses human-readable slugs, not sentinel numbers", () => {
    expect(buildDashboardSearch({ game: "pokemon", activeTripId: -7, activeBuylistId: null, tab: null })).toBe("?view=customers");
    expect(buildDashboardSearch({ game: "mtg", activeTripId: 4, activeBuylistId: null, tab: "sales" })).toBe("?game=mtg&trip=4&tab=sales");
    expect(buildDashboardSearch({ game: "pokemon", activeTripId: null, activeBuylistId: null, tab: null })).toBe("");
  });
  it("falls back to browse on unknown or malformed params", () => {
    const browse = { game: "pokemon", activeTripId: null, activeBuylistId: null, tab: null };
    expect(parseDashboardSearch("?view=nope")).toEqual(browse);
    expect(parseDashboardSearch("?trip=abc")).toEqual(browse);
    expect(parseDashboardSearch("?trip=-3")).toEqual(browse);
    expect(parseDashboardSearch("?game=yugioh")).toEqual(browse);
    expect(parseDashboardSearch("?trip=4&tab=<script>")).toEqual({ ...browse, activeTripId: 4 });
  });
  it("gives a view precedence over trip and buylist when several are present", () => {
    expect(parseDashboardSearch("?view=sales&trip=4&buylist=2").activeTripId).toBe(-2);
  });
});
