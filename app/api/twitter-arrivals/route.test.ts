// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
  }),
}));

import { GET } from "./route";

function request(query = "") {
  return new NextRequest(`http://fixture.local/api/twitter-arrivals${query}`);
}

describe("protected Twitter arrivals route", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.rpc.mockReset();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "operator" } } });
  });

  it("rejects unauthenticated requests without calling the database", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("bounds filters before calling the administrator-only RPC", async () => {
    for (const query of [
      "?limit=0",
      "?limit=101",
      "?limit=nope",
      "?before=nope&before_key=alice%3A1",
      "?before=2026-10-20T12%3A00%3A00Z",
      "?before_key=alice%3A1",
      `?before=2026-10-20T12%3A00%3A00Z&before_key=${"a".repeat(513)}`,
      `?buyer_handle=${"a".repeat(101)}`,
      "?since=yesterday",
      `?since=2026-10-20T12%3A00%3A00Z${"0".repeat(60)}`,
      "?region=Fukuoka",
      "?region=1fukuoka",
      "?region=fuku-oka",
      "?region=fukuoka%00",
      `?region=a${"b".repeat(40)}`,
      "?regions=akihabara,Fukuoka",
      "?regions=akihabara,,fukuoka",
      "?regions=akihabara,",
      "?regions=,akihabara",
      "?regions=akihabara;fukuoka",
      "?region=akihabara&regions=bad-key",
      `?regions=${Array.from({ length: 51 }, (_, index) => `r${index}`).join(",")}`,
    ]) {
      const response = await GET(request(query));
      expect(response.status, query).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("passes bounded filters through the caller session and disables caching", async () => {
    const posts = [{ arrival_key: "alice:1" }];
    mocks.rpc.mockResolvedValue({ data: posts, error: null });

    const response = await GET(request(
      "?buyer_handle=alice&before=2026-10-20T12%3A00%3A00Z&before_key=alice_shop%3A1&limit=25",
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("twitter_arrival_posts", {
      p_buyer_handle: "alice",
      p_before: "2026-10-20T12:00:00Z",
      p_before_key: "alice_shop:1",
      p_limit: 25,
      p_since: null,
    });
    expect(await response.json()).toEqual({ posts, next_cursor: null });
  });

  it("passes the window start to the RPC as p_since", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    const response = await GET(request("?since=2026-10-18T12%3A00%3A00.000Z&limit=100"));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("twitter_arrival_posts", {
      p_buyer_handle: null,
      p_before: null,
      p_before_key: null,
      p_limit: 100,
      p_since: "2026-10-18T12:00:00.000Z",
    });
  });

  it("passes the regions to the RPC as p_regions, deduplicated and sorted", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    const response = await GET(request(
      "?regions=fukuoka,akihabara,fukuoka&since=2026-10-18T12%3A00%3A00.000Z&limit=100",
    ));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("twitter_arrival_posts", {
      p_buyer_handle: null,
      p_before: null,
      p_before_key: null,
      p_limit: 100,
      p_since: "2026-10-18T12:00:00.000Z",
      p_regions: ["akihabara", "fukuoka"],
    });
    // Blanks around a key are trimmed; the longest key the pattern allows passes.
    for (const [query, expected] of [
      ["?regions=%20tokyo_other%20,%20area51", ["area51", "tokyo_other"]],
      [`?regions=a${"b".repeat(39)}`, [`a${"b".repeat(39)}`]],
      [`?regions=${Array.from({ length: 50 }, (_, index) => `r${index}`).join(",")}`, Array.from({ length: 50 }, (_, index) => `r${index}`).sort()],
    ] as const) {
      mocks.rpc.mockClear();
      expect((await GET(request(query))).status, query).toBe(200);
      expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_regions: expected });
    }
    // Duplicates do not count towards the cap.
    mocks.rpc.mockClear();
    expect((await GET(request(`?regions=${Array.from({ length: 60 }, (_, index) => `r${index % 50}`).join(",")}`))).status).toBe(200);
    expect((mocks.rpc.mock.calls[0][1] as { p_regions: string[] }).p_regions).toHaveLength(50);
  });

  it("maps the single region of an old link to p_regions, and never sends p_region", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    expect((await GET(request("?region=fukuoka"))).status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_regions: ["fukuoka"] });
    expect(Object.keys(mocks.rpc.mock.calls[0][1])).not.toContain("p_region");

    // Both together are one filter.
    mocks.rpc.mockClear();
    expect((await GET(request("?region=fukuoka&regions=akihabara,fukuoka"))).status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_regions: ["akihabara", "fukuoka"] });
    expect(Object.keys(mocks.rpc.mock.calls[0][1])).not.toContain("p_region");
  });

  it("leaves p_regions out when no region is asked for, so an older backend keeps answering", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    for (const query of ["", "?regions=", "?region=", "?regions=%20%20", "?buyer_handle=alice&limit=10"]) {
      mocks.rpc.mockClear();
      expect((await GET(request(query))).status, query).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
      expect(Object.keys(mocks.rpc.mock.calls[0][1]), query).not.toContain("p_regions");
      expect(Object.keys(mocks.rpc.mock.calls[0][1]), query).not.toContain("p_region");
    }
  });

  it("answers the backend's refusal of a malformed region as a bad request", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "p_regions may hold at most 50 region keys" },
    });

    const response = await GET(request("?regions=fukuoka"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "p_regions may hold at most 50 region keys" });
  });

  it("returns the stable observed-time cursor when a page reaches its limit", async () => {
    const posts = [
      {
        arrival_key: "alice_shop:2",
        tweet_created_at: "2026-10-20T12:00:00Z",
        acquired_at: "2026-10-20T12:01:00Z",
      },
      {
        arrival_key: "alice_shop:3",
        tweet_created_at: null,
        acquired_at: "2026-10-20T11:59:00Z",
      },
    ];
    mocks.rpc.mockResolvedValue({ data: posts, error: null });

    const response = await GET(request("?limit=2"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      posts,
      next_cursor: {
        before: "2026-10-20T11:59:00Z",
        before_key: "alice_shop:3",
      },
    });
  });

  it("carries a re-post forward in the cursor, since the RPC orders rows by it", async () => {
    const posts = [
      {
        arrival_key: "alice_shop:2",
        tweet_created_at: "2026-10-20T12:00:00Z",
        acquired_at: "2026-10-20T12:01:00Z",
        last_boosted_at: null,
        boost_count: 0,
        via_retweet_of: null,
      },
      {
        arrival_key: "alice_shop:3",
        tweet_created_at: "2026-10-18T09:00:00Z",
        acquired_at: "2026-10-18T09:01:00Z",
        last_boosted_at: "2026-10-20T11:30:00Z",
        boost_count: 2,
        via_retweet_of: "dave_shop",
      },
    ];
    mocks.rpc.mockResolvedValue({ data: posts, error: null });

    const response = await GET(request("?limit=2"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      posts,
      next_cursor: { before: "2026-10-20T11:30:00Z", before_key: "alice_shop:3" },
    });

    // A re-post older than the tweet changes nothing; an unreadable one fails closed.
    mocks.rpc.mockResolvedValue({ data: [{ ...posts[0], last_boosted_at: "2026-10-19T00:00:00Z" }], error: null });
    expect(await (await GET(request("?limit=1"))).json()).toEqual(expect.objectContaining({
      next_cursor: { before: "2026-10-20T12:00:00Z", before_key: "alice_shop:2" },
    }));
    mocks.rpc.mockResolvedValue({ data: [{ ...posts[0], last_boosted_at: "yesterday" }], error: null });
    expect((await GET(request("?limit=1"))).status).toBe(500);
  });

  it("fails closed when a full RPC page cannot produce a stable cursor", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ arrival_key: "alice:1" }],
      error: null,
    });

    const response = await GET(request("?limit=1"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Arrival posts are unavailable" });
  });

  it("maps the database administrator boundary to forbidden", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "arrival browsing requires an administrator" },
    });

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
  });
});
