import { describe, expect, it } from "vitest";
import { buildDashboardSearch, parseDashboardSearch } from "./url-state";
import {
  parseMercariFeedParam,
  parseMercariLaneParam,
  parseMercariSortParam,
  formatRegionsParam,
  parseRegionsParam,
  parseShopParam,
  parseWindowParam,
} from "./url-params";
import { MATCH_REVIEW_SENTINEL } from "./ReviewQueueNavigationContext";

const ARRIVALS = -21;
const MERCARI = -22;
const BUYBACKS = -23;

describe("dashboard URL codec", () => {
  it("round-trips every state shape", () => {
    const cases = [
      { game: "pokemon", activeTripId: null, activeBuylistId: null, tab: null, shop: null, since: null, regions: [], feed: null, lane: null, format: null, sort: null },
      { game: "mtg", activeTripId: null, activeBuylistId: null, tab: null, shop: null, since: null, regions: [], feed: null, lane: null, format: null, sort: null },
      { game: "pokemon_sealed", activeTripId: null, activeBuylistId: null, tab: null, shop: null, since: null, regions: [], feed: null, lane: null, format: null, sort: null },
      { game: "pokemon", activeTripId: -7, activeBuylistId: null, tab: null, shop: null, since: null, regions: [], feed: null, lane: null, format: null, sort: null }, // customers
      { game: "pokemon", activeTripId: 0, activeBuylistId: null, tab: null, shop: null, since: null, regions: [], feed: null, lane: null, format: null, sort: null }, // trips overview
      { game: "pokemon", activeTripId: MATCH_REVIEW_SENTINEL, activeBuylistId: null, tab: null, shop: null, since: null, regions: [], feed: null, lane: null, format: null, sort: null },
      { game: "mtg", activeTripId: 4, activeBuylistId: null, tab: "sales", shop: null, since: null, regions: [], feed: null, lane: null, format: null, sort: null },
      { game: "pokemon", activeTripId: 4, activeBuylistId: null, tab: null, shop: null, since: null, regions: [], feed: null, lane: null, format: null, sort: null },
      { game: "pokemon", activeTripId: null, activeBuylistId: 2, tab: null, shop: null, since: null, regions: [], feed: null, lane: null, format: null, sort: null },
      { game: "pokemon", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: null, since: null, regions: [], feed: null, lane: null, format: null, sort: null },
      { game: "mtg", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: "alice", since: null, regions: [], feed: null, lane: null, format: null, sort: null },
      { game: "pokemon", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: null, since: "7d", regions: [], feed: null, lane: null, format: null, sort: null },
      { game: "mtg", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: "alice", since: "all", regions: [], feed: null, lane: null, format: null, sort: null },
      { game: "pokemon", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: null, since: null, regions: ["fukuoka"], feed: null, lane: null, format: null, sort: null },
      { game: "mtg", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: "alice", since: "7d", regions: ["tokyo_other"], feed: null, lane: null, format: null, sort: null },
      { game: "pokemon", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: null, since: "24h", regions: ["akihabara", "fukuoka", "nagoya"], feed: null, lane: null, format: null, sort: null },
      { game: "pokemon", activeTripId: MERCARI, activeBuylistId: null, tab: null, shop: null, since: null, regions: [], feed: null, lane: null, format: null, sort: null },
      { game: "pokemon", activeTripId: MERCARI, activeBuylistId: null, tab: null, shop: null, since: null, regions: [], feed: "verified", lane: null, format: null, sort: null },
      { game: "mtg", activeTripId: MERCARI, activeBuylistId: null, tab: null, shop: null, since: null, regions: [], feed: null, lane: "psa", format: "auction", sort: "newest" },
      { game: "pokemon", activeTripId: MERCARI, activeBuylistId: null, tab: null, shop: null, since: null, regions: [], feed: "leads", lane: "unpriced", format: null, sort: "multiple" },
    ] as const;
    for (const c of cases) {
      const search = buildDashboardSearch(c);
      expect(parseDashboardSearch(search)).toEqual(c);
    }
  });
  it("uses human-readable slugs, not sentinel numbers", () => {
    expect(buildDashboardSearch({ game: "pokemon", activeTripId: -7, activeBuylistId: null, tab: null, shop: null, since: null, regions: [], feed: null, lane: null, format: null, sort: null })).toBe("?view=customers");
    expect(buildDashboardSearch({ game: "mtg", activeTripId: 4, activeBuylistId: null, tab: "sales", shop: null, since: null, regions: [], feed: null, lane: null, format: null, sort: null })).toBe("?game=mtg&trip=4&tab=sales");
    expect(buildDashboardSearch({ game: "pokemon", activeTripId: null, activeBuylistId: null, tab: null, shop: null, since: null, regions: [], feed: null, lane: null, format: null, sort: null })).toBe("");
  });
  it("falls back to browse on unknown or malformed params", () => {
    const browse = { game: "pokemon", activeTripId: null, activeBuylistId: null, tab: null, shop: null, since: null, regions: [], feed: null, lane: null, format: null, sort: null };
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
    expect(buildDashboardSearch({ game: "pokemon", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: "alice", since: null, regions: [], feed: null, lane: null, format: null, sort: null })).toBe("?view=arrivals&shop=alice");
    expect(parseDashboardSearch("?view=arrivals&shop=alice")).toEqual({ game: "pokemon", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: "alice", since: null, regions: [], feed: null, lane: null, format: null, sort: null });
    // A shop on another view, or with no view, is noise.
    expect(parseDashboardSearch("?view=customers&shop=alice").shop).toBeNull();
    expect(parseDashboardSearch("?shop=alice").shop).toBeNull();
    expect(buildDashboardSearch({ game: "pokemon", activeTripId: -7, activeBuylistId: null, tab: null, shop: "alice", since: null, regions: [], feed: null, lane: null, format: null, sort: null })).toBe("?view=customers");
    // The same bound the API route enforces on buyer_handle.
    expect(parseDashboardSearch(`?view=arrivals&shop=${"a".repeat(101)}`).shop).toBeNull();
    expect(parseDashboardSearch("?view=arrivals&shop=%00alice").shop).toBeNull();
    expect(parseDashboardSearch("?view=arrivals&shop=").shop).toBeNull();
  });
  it("carries the buybacks source as ?shop= only with the buybacks view", () => {
    const buybacks = { game: "pokemon", activeTripId: BUYBACKS, activeBuylistId: null, tab: null, shop: null, since: null, regions: [], feed: null, lane: null, format: null, sort: null } as const;
    expect(buildDashboardSearch(buybacks)).toBe("?view=buybacks");
    expect(buildDashboardSearch({ ...buybacks, shop: "pdg" })).toBe("?view=buybacks&shop=pdg");
    expect(parseDashboardSearch("?view=buybacks&shop=pdg")).toEqual({ ...buybacks, shop: "pdg" });
    // The arrivals window is not a buybacks param.
    expect(parseDashboardSearch("?view=buybacks&shop=pdg&since=7d").since).toBeNull();
    expect(buildDashboardSearch({ ...buybacks, shop: "pdg", since: "7d" })).toBe("?view=buybacks&shop=pdg");
    // The same bound the buylist route enforces on the source.
    expect(parseDashboardSearch(`?view=buybacks&shop=${"a".repeat(101)}`).shop).toBeNull();
    expect(parseDashboardSearch("?view=buybacks&shop=%00pdg").shop).toBeNull();
  });
  it("carries the arrivals time window only with the arrivals view", () => {
    const arrivals = { game: "pokemon", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: null, since: null, regions: [], feed: null, lane: null, format: null, sort: null } as const;
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
  it("carries the arrivals regions only with the arrivals view, as one readable comma-separated list", () => {
    const arrivals = { game: "pokemon", activeTripId: ARRIVALS, activeBuylistId: null, tab: null, shop: null, since: null, regions: [], feed: null, lane: null, format: null, sort: null } as const;
    expect(buildDashboardSearch({ ...arrivals, regions: ["fukuoka"] })).toBe("?view=arrivals&region=fukuoka");
    expect(buildDashboardSearch({ ...arrivals, regions: ["akihabara", "fukuoka"] })).toBe("?view=arrivals&region=akihabara,fukuoka");
    expect(buildDashboardSearch({ ...arrivals, shop: "alice", since: "24h", regions: ["akihabara", "nagoya"] }))
      .toBe("?view=arrivals&shop=alice&since=24h&region=akihabara,nagoya");
    expect(parseDashboardSearch("?view=arrivals&region=akihabara,fukuoka")).toEqual({ ...arrivals, regions: ["akihabara", "fukuoka"] });
    // The escaped comma a browser or a share sheet may produce reads the same.
    expect(parseDashboardSearch("?view=arrivals&region=akihabara%2Cfukuoka").regions).toEqual(["akihabara", "fukuoka"]);
    // A single key, as links from before the filter took several regions, still reads.
    expect(parseDashboardSearch("?view=arrivals&region=fukuoka")).toEqual({ ...arrivals, regions: ["fukuoka"] });
    // All regions stays out of the URL.
    expect(buildDashboardSearch(arrivals)).toBe("?view=arrivals");
    expect(parseDashboardSearch("?view=arrivals").regions).toEqual([]);
    // Regions on another view are noise.
    expect(parseDashboardSearch("?view=customers&region=fukuoka").regions).toEqual([]);
    expect(parseDashboardSearch("?view=buybacks&shop=pdg&region=fukuoka").regions).toEqual([]);
    expect(parseDashboardSearch("?region=fukuoka").regions).toEqual([]);
    expect(buildDashboardSearch({ ...arrivals, activeTripId: -7, regions: ["fukuoka"] })).toBe("?view=customers");
    expect(buildDashboardSearch({ ...arrivals, activeTripId: MERCARI, regions: ["fukuoka"] })).toBe("?view=mercari");
  });
  it("reads a region list the way the API route checks it: malformed keys dropped, each key once, sorted", () => {
    expect(parseRegionsParam("fukuoka")).toEqual(["fukuoka"]);
    expect(parseRegionsParam("fukuoka,akihabara")).toEqual(["akihabara", "fukuoka"]);
    expect(parseRegionsParam(" tokyo_other , fukuoka ,tokyo_other")).toEqual(["fukuoka", "tokyo_other"]);
    expect(parseRegionsParam("Fukuoka,fuku-oka,1abc,,akihabara,")).toEqual(["akihabara"]);
    expect(parseRegionsParam(`a${"b".repeat(39)},a${"b".repeat(40)}`)).toEqual([`a${"b".repeat(39)}`]);
    expect(parseRegionsParam(Array.from({ length: 60 }, (_, index) => `r${String(index).padStart(2, "0")}`).join(",")))
      .toHaveLength(50);
    expect(parseRegionsParam("")).toEqual([]);
    expect(parseRegionsParam(null)).toEqual([]);
    expect(parseRegionsParam(undefined)).toEqual([]);
    expect(formatRegionsParam(["akihabara", "fukuoka"])).toBe("akihabara,fukuoka");
    expect(formatRegionsParam([])).toBeNull();
  });
  it("carries the Mercari feed, lane and sort only with the Mercari view", () => {
    const mercari = { game: "pokemon", activeTripId: MERCARI, activeBuylistId: null, tab: null, shop: null, since: null, regions: [], feed: null, lane: null, format: null, sort: null } as const;
    expect(buildDashboardSearch(mercari)).toBe("?view=mercari");
    expect(buildDashboardSearch({ ...mercari, feed: "verified" })).toBe("?view=mercari&feed=verified");
    expect(buildDashboardSearch({ ...mercari, lane: "vintage_raw", sort: "newest" })).toBe("?view=mercari&lane=vintage_raw&sort=newest");
    expect(parseDashboardSearch("?view=mercari&lane=psa")).toEqual({ ...mercari, lane: "psa" });
    expect(buildDashboardSearch({ ...mercari, lane: "psa", format: "auction", sort: "ending" }))
      .toBe("?view=mercari&lane=psa&format=auction&sort=ending");
    expect(parseDashboardSearch("?view=mercari&format=auction")).toEqual({ ...mercari, format: "auction" });
    expect(parseDashboardSearch("?view=mercari&format=auctions").format).toBeNull();
    expect(parseDashboardSearch("?view=arrivals&format=auction").format).toBeNull();
    // Mercari params on another view, or values the tab does not offer, are noise.
    expect(parseDashboardSearch("?view=arrivals&lane=psa&feed=verified&sort=newest")).toMatchObject({ feed: null, lane: null, format: null, sort: null });
    expect(buildDashboardSearch({ ...mercari, activeTripId: ARRIVALS, lane: "psa", feed: "verified" })).toBe("?view=arrivals");
    expect(parseDashboardSearch("?view=mercari&lane=graded&feed=all&sort=price")).toEqual(mercari);
    // The arrivals params are noise on the Mercari view.
    expect(parseDashboardSearch("?view=mercari&shop=alice&since=7d&region=fukuoka,akihabara")).toEqual(mercari);
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
