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
    });
    expect(await response.json()).toEqual({ posts });
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
