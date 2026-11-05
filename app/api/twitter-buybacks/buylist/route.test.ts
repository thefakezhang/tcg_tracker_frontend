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
  return new NextRequest(`http://fixture.local/api/twitter-buybacks/buylist${query}`);
}

describe("protected Twitter buyback buylist route", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.rpc.mockReset();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "operator" } } });
  });

  it("rejects unauthenticated requests without calling the database", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await GET(request("?source=pdg"));

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires a bounded source handle before calling the RPC", async () => {
    for (const query of ["", "?source=", "?source=%20%20", `?source=${"a".repeat(101)}`, "?source=pd%00g"]) {
      const response = await GET(request(query));
      expect(response.status, query).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("passes the trimmed source with the caller session and disables caching", async () => {
    const buylist = { source: "pdg", known: true, rows: [] };
    mocks.rpc.mockResolvedValue({ data: buylist, error: null });

    const response = await GET(request("?source=%20pdg%20"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("twitter_buyback_buylist", { p_source: "pdg" });
    expect(await response.json()).toEqual({ buylist });
  });

  it("maps the administrator refusal to 403 and the absent migration to 501", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "buyback browsing requires an administrator" },
    });
    let response = await GET(request("?source=pdg"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });

    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.twitter_buyback_buylist(p_source) in the schema cache" },
    });
    response = await GET(request("?source=pdg"));
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: "The buylist is unavailable", reason: "rpc-missing" });
  });

  it("passes the backend's own refusal through as 400 and hides other failures", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "a buyback source handle of 1 to 100 characters is required" },
    });
    let response = await GET(request("?source=pdg"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "a buyback source handle of 1 to 100 characters is required" });

    mocks.rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "statement timeout" } });
    response = await GET(request("?source=pdg"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "The buylist is unavailable" });
  });
});
