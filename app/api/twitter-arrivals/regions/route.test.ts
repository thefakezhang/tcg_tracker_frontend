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

import { GET, POST } from "./route";

const STATUS = { today: "2026-11-02", focus_source: "default", regions: [] };

function post(body: unknown) {
  return new NextRequest("http://fixture.local/api/twitter-arrivals/regions", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("protected Twitter arrival regions route", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.rpc.mockReset();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "operator" } } });
    mocks.rpc.mockResolvedValue({ data: STATUS, error: null });
  });

  it("rejects unauthenticated requests without calling the database", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET()).status).toBe(401);
    expect((await POST(post({ action: "request_read", region: "osaka" }))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reads the status through the caller's session and disables caching", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("twitter_arrivals_focus_status");
    expect(await response.json()).toEqual({ status: STATUS });
  });

  it.each([
    [{ action: "set_focus", region: "osaka", until: "2026-11-10" },
      "twitter_arrivals_set_focus", { p_region: "osaka", p_until: "2026-11-10" }],
    [{ action: "set_focus", region: "osaka", until: null },
      "twitter_arrivals_set_focus", { p_region: "osaka", p_until: null }],
    [{ action: "clear_focus", region: "akihabara" },
      "twitter_arrivals_clear_focus", { p_region: "akihabara" }],
    [{ action: "reset_focus" }, "twitter_arrivals_clear_focus", { p_region: null }],
    [{ action: "request_read", region: "osaka" },
      "twitter_arrivals_request_read", { p_region: "osaka" }],
    [{ action: "resume_read", region: "osaka", request_id: 61 },
      "twitter_arrivals_resume_read", { p_request_id: 61 }],
  ])("maps %o to its RPC", async (body, name, args) => {
    const response = await POST(post(body));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(name, args);
    expect(await response.json()).toEqual({ status: STATUS });
  });

  it.each([
    ["not JSON", "{"],
    ["an unknown action", { action: "delete", region: "osaka" }],
    ["a region that is not a key", { action: "request_read", region: "Osaka; drop" }],
    ["a date that is not a Tokyo date", { action: "set_focus", region: "osaka", until: "tomorrow" }],
    ["a missing date", { action: "set_focus", region: "osaka" }],
    ["a resume without its request id", { action: "resume_read", region: "osaka" }],
    ["a resume of request 0", { action: "resume_read", region: "osaka", request_id: 0 }],
    ["a resume of a negative id", { action: "resume_read", region: "osaka", request_id: -3 }],
    ["a resume of a fractional id", { action: "resume_read", region: "osaka", request_id: 1.5 }],
    ["a resume of a string id", { action: "resume_read", region: "osaka", request_id: "61" }],
    ["a resume of an unsafe id", { action: "resume_read", region: "osaka", request_id: 2 ** 53 }],
    ["a resume without a region key", { action: "resume_read", region: "Osaka", request_id: 61 }],
  ])("refuses %s before calling the database", async (_name, body) => {
    expect((await POST(post(body))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps the administrator boundary, the missing migration and the backend's refusals", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null, error: { code: "42501", message: "arrival focus requires an administrator" },
    });
    const forbidden = await GET();
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "Forbidden" });

    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.twitter_arrivals_focus_status" },
    });
    const missing = await GET();
    expect(missing.status).toBe(501);
    expect(await missing.json()).toMatchObject({ reason: "rpc-missing" });

    mocks.rpc.mockResolvedValueOnce({
      data: null, error: { code: "22023", message: "region has no readable list yet" },
    });
    const refused = await POST(post({ action: "request_read", region: "sapporo" }));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "region has no readable list yet" });

    // A backend from before migration 000643 has no resume_read: 501, which
    // the tab reads as "stop re-sending", never as a reason to request again.
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.twitter_arrivals_resume_read" },
    });
    const noResume = await POST(post({ action: "resume_read", region: "osaka", request_id: 61 }));
    expect(noResume.status).toBe(501);
    expect(mocks.rpc).toHaveBeenLastCalledWith("twitter_arrivals_resume_read", { p_request_id: 61 });

    mocks.rpc.mockResolvedValueOnce({
      data: null, error: { code: "22023", message: "unknown read-once request" },
    });
    const unknown = await POST(post({ action: "resume_read", region: "osaka", request_id: 999 }));
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "unknown read-once request" });

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "57014", message: "canceling statement" } });
    const failed = await POST(post({ action: "request_read", region: "osaka" }));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "Region controls are unavailable" });
  });
});
