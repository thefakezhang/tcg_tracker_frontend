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
  return new NextRequest(`http://fixture.local/api/twitter-arrivals/sources${query}`);
}

describe("protected Twitter arrival sources route", () => {
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

  it("bounds the since filter before calling the administrator-only RPC", async () => {
    for (const query of ["?since=nope", `?since=${"2".repeat(65)}`]) {
      const response = await GET(request(query));
      expect(response.status, query).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("passes the caller session through, leaves the backend default window, and disables caching", async () => {
    const sources = [{ buyer_handle: "alice", twitter_handle: "alice_shop", post_count: 3, recent_count: 1, latest_post_at: "2026-10-20T01:15:00Z" }];
    mocks.rpc.mockResolvedValue({ data: sources, error: null });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("twitter_arrival_sources", { p_since: null });
    expect(await response.json()).toEqual({ sources });
  });

  it("forwards an explicit since window and answers an empty summary as an empty list", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    const response = await GET(request("?since=2026-10-19T12%3A00%3A00Z"));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("twitter_arrival_sources", { p_since: "2026-10-19T12:00:00Z" });
    expect(await response.json()).toEqual({ sources: [] });
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

  it("reports a missing RPC as 501 so the browser can derive the list itself", async () => {
    for (const error of [
      { code: "PGRST202", message: "Could not find the function public.twitter_arrival_sources(p_since) in the schema cache" },
      { code: "42883", message: "function twitter_arrival_sources(timestamp with time zone) does not exist" },
    ]) {
      mocks.rpc.mockResolvedValue({ data: null, error });
      const response = await GET(request());
      expect(response.status, error.code).toBe(501);
      expect(await response.json()).toEqual({
        error: "Arrival accounts are unavailable",
        reason: "rpc-missing",
      });
    }
  });

  it("hides every other database failure behind a generic 500", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    });

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Arrival accounts are unavailable" });
  });
});
