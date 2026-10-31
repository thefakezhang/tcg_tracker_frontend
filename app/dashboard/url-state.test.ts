import { describe, expect, it } from "vitest";
import { buildDashboardSearch, parseDashboardSearch } from "./url-state";
import {
  parseMercariFeedParam,
  parseMercariLaneParam,
  parseMercariSortParam,
  parseShopParam,
  parseWindowParam,
} from "./url-params";
import { MATCH_REVIEW_SENTINEL } from "./ReviewQueueNavigationContext";

const ARRIVALS = -21;
const MERCARI = -22;

describe("dashboard URL codec", () => {
  it("round-trips every state shape", () => {
    const cases = [
      { game: "pokemon", activeTripId: null, activeBuylistId: null, tab: null, shop: null, since: null, feed: null, lane: null, sort: null },
      { game: "mtg", activeTripId: null, activeBuylistId: null, tab: null, shop: null, since: null, feed: null, lane: null, sort: null },
      { game: "pokemon_sealed", activeTripId: null, activeBuylistId: null, tab: null, shop: null, since: null, feed: null, lane: null, sort: null },
      { game: "pokemon", activeTripId: -7, activeBuylistId: null, tab: null, shop: null, since: null, feed: null, lane: null, sort: null }, // customers
      { game: "pokemon", activeTripId: 0, activeBuylistId: null, tab: null, shop: null, since: null, feed: null, lane: null, sort: null }, // trips overview
      { game: "pokemon", activeTripId: MATCH_REVIEW_SENTINEL, activeBuylistId: null, tab: null, shop: null, since: null, feed: null, lane: null, sort: null },
      { game: "mtg", activeTripId: 4, activeBuylistId: null, tab: "sales", shop: null, since: null, feed: null, lane: null, sort: null },
      { game: "pokemon", activeTripId: 4, activeBuylistId: null, tab: null, shop: null, since: null, feed: null, lane: null, sort: null },
      { game: "pokemon", activeTripId: null, activeBuylistId: 2, tab: null, shop: null, since: null, feed: null, lane: null, sort: null },
      { game: "pokemon", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: null, since: null, feed: null, lane: null, sort: null },
      { game: "mtg", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: "alice", since: null, feed: null, lane: null, sort: null },
      { game: "pokemon", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: null, since: "7d", feed: null, lane: null, sort: null },
      { game: "mtg", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: "alice", since: "all", feed: null, lane: null, sort: null },
      { game: "pokemon", activeTripId: MERCARI, activeBuylistId: null, tab: null, shop: null, since: null, feed: null, lane: null, sort: null },
      { game: "pokemon", activeTripId: MERCARI, activeBuylistId: null, tab: null, shop: null, since: null, feed: "verified", lane: null, sort: null },
      { game: "mtg", activeTripId: MERCARI, activeBuylistId: null, tab: null, shop: null, since: null, feed: null, lane: "psa", sort: "newest" },
      { game: "pokemon", activeTripId: MERCARI, activeBuylistId: null, tab: null, shop: null, since: null, feed: "leads", lane: "unpriced", sort: "multiple" },
    ] as const;
    for (const c of cases) {
      const search = buildDashboardSearch(c);
      expect(parseDashboardSearch(search)).toEqual(c);
    }
  });
  it("uses human-readable slugs, not sentinel numbers", () => {
    expect(buildDashboardSearch({ game: "pokemon", activeTripId: -7, activeBuylistId: null, tab: null, shop: null, since: null, feed: null, lane: null, sort: null })).toBe("?view=customers");
    expect(buildDashboardSearch({ game: "mtg", activeTripId: 4, activeBuylistId: null, tab: "sales", shop: null, since: null, feed: null, lane: null, sort: null })).toBe("?game=mtg&trip=4&tab=sales");
    expect(buildDashboardSearch({ game: "pokemon", activeTripId: null, activeBuylistId: null, tab: null, shop: null, since: null, feed: null, lane: null, sort: null })).toBe("");
  });
  it("falls back to browse on unknown or malformed params", () => {
    const browse = { game: "pokemon", activeTripId: null, activeBuylistId: null, tab: null, shop: null, since: null, feed: null, lane: null, sort: null };
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
    expect(buildDashboardSearch({ game: "pokemon", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: "alice", since: null, feed: null, lane: null, sort: null })).toBe("?view=arrivals&shop=alice");
    expect(parseDashboardSearch("?view=arrivals&shop=alice")).toEqual({ game: "pokemon", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: "alice", since: null, feed: null, lane: null, sort: null });
    // A shop on another view, or with no view, is noise.
    expect(parseDashboardSearch("?view=customers&shop=alice").shop).toBeNull();
    expect(parseDashboardSearch("?shop=alice").shop).toBeNull();
    expect(buildDashboardSearch({ game: "pokemon", activeTripId: -7, activeBuylistId: null, tab: null, shop: "alice", since: null, feed: null, lane: null, sort: null })).toBe("?view=customers");
    // The same bound the API route enforces on buyer_handle.
    expect(parseDashboardSearch(`?view=arrivals&shop=${"a".repeat(101)}`).shop).toBeNull();
    expect(parseDashboardSearch("?view=arrivals&shop=%00alice").shop).toBeNull();
    expect(parseDashboardSearch("?view=arrivals&shop=").shop).toBeNull();
  });
  it("carries the arrivals time window only with the arrivals view", () => {
    const arrivals = { game: "pokemon", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: null, since: null, feed: null, lane: null, sort: null } as const;
    expect(buildDashboardSearch({ ...arrivals, since: "24h" })).toBe("?view=arrivals&since=24h");
    expect(buildDashboardSearch({ ...arrivals, shop: "alice", since: "all" })).toBe("?view=arrivals&shop=alice&since=all");
    expect(parseDashboardSearch("?view=arrivals&since=7d")).toEqual({ ...arrivals, since: "7d" });
    // The view keeps its default (48 h) out of the URL; the codec passes through whatever a link says.
    expect(buildDashboardSearch(arrivals)).toBe("?view=arrivals");
    expect(parseDashboardSearch("?view=arrivals").since).toBeNull();
    expect(parseDashboardSearch("?view=arrivals&since=48h").since).toBe("48h");
    // A window on another view, or one the tab does not offer, is noise.
    expect(parseDashboardSearch("?view=customers&since=24h").since).toBeNull();
    expect(buildDashboardSearch({ ...arrivals, activeTripId: -7, since: "24h" })).toBe("?view=customers");
    expect(parseDashboardSearch("?view=arrivals&since=3d").since).toBeNull();
    expect(parseDashboardSearch("?view=arrivals&since=").since).toBeNull();
  });
  it("carries the Mercari feed, lane and sort only with the Mercari view", () => {
    const mercari = { game: "pokemon", activeTripId: MERCARI, activeBuylistId: null, tab: null, shop: null, since: null, feed: null, lane: null, sort: null } as const;
    expect(buildDashboardSearch(mercari)).toBe("?view=mercari");
    expect(buildDashboardSearch({ ...mercari, feed: "verified" })).toBe("?view=mercari&feed=verified");
    expect(buildDashboardSearch({ ...mercari, lane: "vintage_raw", sort: "newest" })).toBe("?view=mercari&lane=vintage_raw&sort=newest");
    expect(parseDashboardSearch("?view=mercari&lane=psa")).toEqual({ ...mercari, lane: "psa" });
    // Mercari params on another view, or values the tab does not offer, are noise.
    expect(parseDashboardSearch("?view=arrivals&lane=psa&feed=verified&sort=newest")).toMatchObject({ feed: null, lane: null, sort: null });
    expect(buildDashboardSearch({ ...mercari, activeTripId: ARRIVALS, lane: "psa", feed: "verified" })).toBe("?view=arrivals");
    expect(parseDashboardSearch("?view=mercari&lane=graded&feed=all&sort=price")).toEqual(mercari);
    // The arrivals params are noise on the Mercari view.
    expect(parseDashboardSearch("?view=mercari&shop=alice&since=7d")).toEqual(mercari);
  });
  it("accepts only the Mercari feeds, lanes and sorts the tab offers", () => {
    expect(parseMercariFeedParam(" verified ")).toBe("verified");
    expect(parseMercariFeedParam("leads")).toBe("leads");
    expect(parseMercariFeedParam("Verified")).toBeNull();
    for (const lane of ["modern_raw", "vintage_raw", "psa", "unpriced"] as const) {
      expect(parseMercariLaneParam(lane)).toBe(lane);
    }
    expect(parseMercariLaneParam("raw")).toBeNull();
    expect(parseMercariLaneParam("")).toBeNull();
    expect(parseMercariLaneParam(null)).toBeNull();
    expect(parseMercariSortParam("multiple")).toBe("multiple");
    expect(parseMercariSortParam("newest")).toBe("newest");
    expect(parseMercariSortParam("oldest")).toBeNull();
    expect(parseMercariSortParam(undefined)).toBeNull();
  });
  it("validates a shop handle the way the route does", () => {
    expect(parseShopParam(" alice ")).toBe("alice");
    expect(parseShopParam("")).toBeNull();
    expect(parseShopParam(null)).toBeNull();
    expect(parseShopParam("a".repeat(100))).toBe("a".repeat(100));
    expect(parseShopParam("a".repeat(101))).toBeNull();
    expect(parseShopParam("bad\u0007handle")).toBeNull();
  });
  it("accepts only the windows the tab offers", () => {
    for (const window of ["24h", "48h", "7d", "all"] as const) {
      expect(parseWindowParam(window)).toBe(window);
    }
    expect(parseWindowParam(" 48h ")).toBe("48h");
    expect(parseWindowParam("48H")).toBeNull();
    expect(parseWindowParam("2d")).toBeNull();
    expect(parseWindowParam("")).toBeNull();
    expect(parseWindowParam(null)).toBeNull();
    expect(parseWindowParam(undefined)).toBeNull();
  });
});
