// @vitest-environment node

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

describe("protected Twitter buyback overview route", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.rpc.mockReset();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "operator" } } });
  });

  it("rejects unauthenticated requests without calling the database", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("passes the caller session to the administrator-only RPC and disables caching", async () => {
    const overview = { generated_at: "2026-11-05T21:00:00Z", sources: [] };
    mocks.rpc.mockResolvedValue({ data: overview, error: null });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("twitter_buyback_sources");
    expect(await response.json()).toEqual({ overview });
  });

  it("maps the database administrator boundary to forbidden", async () => {
    for (const error of [
      { code: "42501", message: "buyback browsing requires an administrator" },
      { code: "P0001", message: "buyback browsing requires an administrator" },
    ]) {
      mocks.rpc.mockResolvedValue({ data: null, error });
      const response = await GET();
      expect(response.status, error.code).toBe(403);
      expect(await response.json()).toEqual({ error: "Forbidden" });
    }
  });

  it("reports a missing RPC as 501 so the tab can say it waits for the migration", async () => {
    for (const error of [
      { code: "PGRST202", message: "Could not find the function public.twitter_buyback_sources without parameters in the schema cache" },
      { code: "42883", message: "function twitter_buyback_sources() does not exist" },
    ]) {
      mocks.rpc.mockResolvedValue({ data: null, error });
      const response = await GET();
      expect(response.status, error.code).toBe(501);
      expect(await response.json()).toEqual({ error: "Buyback sources are unavailable", reason: "rpc-missing" });
    }
  });

  it("hides every other database failure and a malformed document behind a generic 500", async () => {
    for (const answer of [
      { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } },
      { data: null, error: null },
      { data: [], error: null },
    ]) {
      mocks.rpc.mockResolvedValue(answer);
      const response = await GET();
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Buyback sources are unavailable" });
    }
  });
});
