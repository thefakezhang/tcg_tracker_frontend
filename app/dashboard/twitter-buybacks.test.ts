import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BuybackRequestError,
  cropLayout,
  countByFreshness,
  filterBuybackRows,
  lastChecked,
  loadBuybackBuylist,
  loadBuybackOverview,
  matchesBuybackQuery,
  matchesSourceQuery,
  parseBuybackBuylist,
  parseBuybackOverview,
  pollingProblems,
  sortBuybackRows,
} from "./twitter-buybacks";
import { LAURIER, buylistDoc, overviewDoc, rowDoc, sourceDoc } from "./twitter-buybacks.test-fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("parseBuybackOverview", () => {
  it("reads the backend document in its order", () => {
    const overview = parseBuybackOverview(overviewDoc());
    expect(overview.sources.map((source) => source.source)).toEqual(["pdg", "laurier", "clover_base"]);
    expect(overview.auto_accept).toEqual({ global_enabled: true, global_daily_cap: 50000, global_used_today: 826 });
    const pdg = overview.sources[0];
    expect(pdg.accounts).toEqual(["PDGcollectors", "PDGcollectors_2"]);
    expect(pdg.latest_sheet.auto_approved).toBe(11);
    expect(pdg.buylist).toEqual({ cards: 415, live_cards: 415, live_bids: 371 });
    expect(overview.sources[2].auto_accept.fingerprint_current).toBeNull();
    expect(overview.sources[2].auto_accept.daily_cap).toBeNull();
    expect(overview.sources[1].latest_tweet.read_at).toBeNull();
  });

  it("fails closed on a malformed field instead of rendering a guess", () => {
    const cases: [string, (doc: Record<string, any>) => void][] = [
      ["unknown freshness", (doc) => { doc.sources[0].freshness = "stale"; }],
      ["negative count", (doc) => { doc.sources[0].tweets_24h = -1; }],
      ["fractional count", (doc) => { doc.sources[0].buylist.cards = 1.5; }],
      ["unparseable time", (doc) => { doc.sources[0].latest_tweet.tweeted_at = "yesterday"; }],
      ["non-http post link", (doc) => { doc.sources[0].latest_tweet.tweet_url = "javascript:alert(1)"; }],
      ["sheet counts that do not add up", (doc) => { doc.sources[0].latest_sheet.cells = 14; }],
      ["more live bids than live cards", (doc) => { doc.sources[0].buylist.live_bids = 416; }],
      ["missing auto-accept flag", (doc) => { delete doc.sources[0].auto_accept.enabled; }],
      ["blank account", (doc) => { doc.sources[0].accounts = [""]; }],
      ["sources not a list", (doc) => { doc.sources = {}; }],
    ];
    for (const [name, mutate] of cases) {
      const doc = clone(overviewDoc());
      mutate(doc);
      expect(() => parseBuybackOverview(doc), name).toThrow(/Invalid buyback field/);
    }
  });
});

describe("parseBuybackBuylist", () => {
  it("reads rows with their crop boxes, and treats UNKNOWN as no value", () => {
    const buylist = parseBuybackBuylist(buylistDoc());
    expect(buylist.rows).toHaveLength(4);
    const [mew, serena, charizard] = buylist.rows;
    expect(mew.sheet?.card).toEqual({ x0: 947, y0: 374, x1: 1411, y1: 981 });
    expect(mew.sheet?.price).toEqual({ x0: 931, y0: 1052, x1: 1435, y1: 1173 });
    expect(mew.tweets.map((tweet) => tweet.account)).toEqual(["PDGcollectors_2", "PDGcollectors"]);
    expect(serena.card.misc_info).toBeNull();
    expect(serena.price_jpy).toBe(477000);
    expect(serena.read_price_jpy).toBe(1680000);
    expect(charizard.sheet).toBeNull();
  });

  it("reads a legacy flat box as the card, and drops a box outside the image", () => {
    const flat = parseBuybackBuylist(buylistDoc({
      rows: [rowDoc({ sheet: { image_url: "https://img.test/a.jpg", width: 100, height: 100, geometry: { x0: 1, y0: 2, x1: 50, y1: 60 } } })],
    }));
    expect(flat.rows[0].sheet?.card).toEqual({ x0: 1, y0: 2, x1: 50, y1: 60 });
    expect(flat.rows[0].sheet?.price).toBeNull();
    const outside = parseBuybackBuylist(buylistDoc({
      rows: [rowDoc({ sheet: { image_url: "https://img.test/a.jpg", width: 100, height: 100, geometry: { card: { x0: 10, y0: 10, x1: 150, y1: 50 }, price: null } } })],
    }));
    expect(outside.rows[0].sheet?.card).toBeNull();
  });

  it("an unknown source is an empty, valid buylist", () => {
    const buylist = parseBuybackBuylist({ source: "nobody", known: false, generated_at: "2026-11-05T21:00:00Z", latest_tweet_at: null, window_started_at: null, rows: [] });
    expect(buylist.known).toBe(false);
    expect(buylist.rows).toEqual([]);
  });

  it("fails closed on rows the backend cannot have produced", () => {
    const cases: [string, Record<string, unknown>][] = [
      ["unknown grade", rowDoc({ grade: "psa_9" })],
      ["rejected is not a quote", rowDoc({ status: "rejected", verified: false })],
      ["verified flag disagrees with status", rowDoc({ status: "pending", verified: true })],
      ["in-review price differs from the read", rowDoc({ status: "pending", verified: false, price_jpy: 1, read_price_jpy: 2 })],
      ["no tweet", rowDoc({ tweets: [] })],
      ["non-http sheet", rowDoc({ sheet: { image_url: "data:image/png;base64,AA", width: 1, height: 1, geometry: null } })],
      ["non-numeric box", rowDoc({ sheet: { image_url: "https://img.test/a.jpg", width: 10, height: 10, geometry: { card: { x0: "1", y0: 0, x1: 5, y1: 5 } } } })],
      ["missing card name", rowDoc({ card: { name: "" } })],
    ];
    for (const [name, row] of cases) {
      expect(() => parseBuybackBuylist(buylistDoc({ rows: [row] })), name).toThrow(/Invalid buyback field/);
    }
  });
});

describe("buylist filters and sorts", () => {
  const rows = parseBuybackBuylist(buylistDoc()).rows;

  it("searches card names in both languages, set code or name, number and printing", () => {
    const names = (query: string) => rows.filter((row) => matchesBuybackQuery(row, query)).map((row) => row.card.card_id);
    expect(names("mew")).toEqual([794930]);
    expect(names("ミュウ")).toEqual([794930]);
    expect(names("151")).toEqual([800001, 800002]);
    expect(names("sv2a 025")).toEqual([800002]);
    expect(names("ミラー")).toEqual([800002]);
    expect(names("old-upc")).toEqual([794930]);
    // Full-width input normalizes like the half-width spelling.
    expect(names("ＳＶ２ａ")).toEqual([800001, 800002]);
    expect(names("  ")).toHaveLength(4);
  });

  it("filters by grade and verification together", () => {
    const ids = (filters: Parameters<typeof filterBuybackRows>[1]) =>
      filterBuybackRows(rows, filters).map((row) => row.card.card_id);
    expect(ids({ grade: "psa_10", verification: "all", query: "" })).toEqual([799208]);
    expect(ids({ grade: "raw", verification: "verified", query: "" })).toEqual([794930]);
    expect(ids({ grade: "all", verification: "review", query: "" })).toEqual([800001, 800002]);
    expect(ids({ grade: "psa_10", verification: "review", query: "" })).toEqual([]);
  });

  it("sorts by newest quote or by price, ties newest first", () => {
    expect(sortBuybackRows(rows, "newest").map((row) => row.card.card_id)).toEqual([799208, 794930, 800001, 800002]);
    expect(sortBuybackRows(rows, "price_desc").map((row) => row.price_jpy)).toEqual([477000, 90000, 1200, 300]);
    expect(sortBuybackRows(rows, "price_asc").map((row) => row.price_jpy)).toEqual([300, 1200, 90000, 477000]);
    const tied = parseBuybackBuylist(buylistDoc({
      rows: [
        rowDoc({ card: { card_id: 2 }, quoted_at: "2026-11-04T00:00:00Z" }),
        rowDoc({ card: { card_id: 1 }, quoted_at: "2026-11-05T00:00:00Z" }),
      ],
    })).rows;
    expect(sortBuybackRows(tied, "price_desc").map((row) => row.card.card_id)).toEqual([1, 2]);
  });
});

describe("source helpers", () => {
  const overview = parseBuybackOverview(overviewDoc());
  const [pdg, laurier, clover] = overview.sources;

  it("searches the source handle and every account, with or without @", () => {
    expect(matchesSourceQuery(pdg, "@PDGcollectors_2")).toBe(true);
    expect(matchesSourceQuery(pdg, "pdg")).toBe(true);
    expect(matchesSourceQuery(laurier, "pdg")).toBe(false);
  });

  it("counts sources per freshness band", () => {
    expect(countByFreshness(overview.sources)).toEqual({ fresh: 1, aging: 1, expired: 1 });
  });

  it("reports the latest check of an active account and the accounts not read normally", () => {
    expect(lastChecked(laurier)).toBe((LAURIER.polling as { last_polled_at: string }[])[0].last_polled_at);
    expect(pollingProblems(laurier).map((row) => row.account)).toEqual(["laurier_akiba2"]);
    expect(pollingProblems(pdg)).toEqual([]);
    expect(lastChecked(clover)).toBeNull();
    const pausedOnly = parseBuybackOverview(overviewDoc([sourceDoc({
      polling: [{ account: "x", status: "paused", last_polled_at: "2026-10-01T00:00:00Z", next_poll_at: null, consecutive_failures: 0 }],
    })])).sources[0];
    expect(lastChecked(pausedOnly)).toBe("2026-10-01T00:00:00Z");
  });
});

describe("cropLayout", () => {
  it("fits the box inside the frame and keeps its aspect", () => {
    expect(cropLayout({ x0: 947, y0: 374, x1: 1411, y1: 981 }, 64, 88)).toEqual({
      frameWidth: 64,
      frameHeight: 84,
      imageWidth: 464,
      imageHeight: 607,
      offsetX: 947,
      offsetY: 374,
      scale: 64 / 464,
    });
    // A wide price banner is bound by the width; a tall one by the height.
    expect(cropLayout({ x0: 0, y0: 0, x1: 500, y1: 100 }, 64, 24).frameWidth).toBe(64);
    expect(cropLayout({ x0: 0, y0: 0, x1: 100, y1: 100 }, 64, 24).frameHeight).toBe(24);
  });
});

describe("loaders", () => {
  function respond(status: number, body: unknown) {
    const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("read the private routes without caching", async () => {
    const fetch = respond(200, { overview: overviewDoc() });
    expect((await loadBuybackOverview())?.sources).toHaveLength(3);
    expect(fetch).toHaveBeenCalledWith("/api/twitter-buybacks", expect.objectContaining({ cache: "no-store" }));

    const buylistFetch = respond(200, { buylist: buylistDoc() });
    expect((await loadBuybackBuylist("pdg & co"))?.rows).toHaveLength(4);
    expect(buylistFetch).toHaveBeenCalledWith(
      "/api/twitter-buybacks/buylist?source=pdg+%26+co",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("answer null while the migration is absent and raise the route's status otherwise", async () => {
    respond(501, { error: "Buyback sources are unavailable", reason: "rpc-missing" });
    expect(await loadBuybackOverview()).toBeNull();
    respond(501, { error: "The buylist is unavailable", reason: "rpc-missing" });
    expect(await loadBuybackBuylist("pdg")).toBeNull();

    respond(403, { error: "Forbidden" });
    const forbidden = await loadBuybackOverview().catch((error: unknown) => error);
    expect(forbidden).toBeInstanceOf(BuybackRequestError);
    expect((forbidden as BuybackRequestError).status).toBe(403);
    expect((forbidden as Error).message).toBe("Forbidden");

    respond(200, { nope: true });
    await expect(loadBuybackBuylist("pdg")).rejects.toThrow(/Invalid buyback buylist response/);
  });
});
