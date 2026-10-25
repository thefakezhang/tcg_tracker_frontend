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
