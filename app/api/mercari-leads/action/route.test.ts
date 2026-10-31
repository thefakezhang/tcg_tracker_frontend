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

import { POST } from "./route";

function request(body: unknown) {
  return new NextRequest("http://fixture.local/api/mercari-leads/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("Mercari lead action route", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.rpc.mockReset();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "operator" } } });
    mocks.rpc.mockResolvedValue({ data: { action_id: 1 }, error: null });
  });

  it("rejects unauthenticated requests without calling the RPC", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(request({ external_item_id: "m12345678901", action: "photo_check_requested" }));

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a dismissal without a reason before calling the RPC", async () => {
    for (const body of [
      { external_item_id: "m12345678901", action: "dismissed" },
      { external_item_id: "m12345678901", action: "dismissed", reason: "" },
      { external_item_id: "m12345678901", action: "dismissed", reason: "   " },
      { external_item_id: "m12345678901", action: "dismissed", reason: null },
    ]) {
      const response = await POST(request(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual({ error: "a dismissal requires a reason" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("bounds the rest of the body before calling the RPC", async () => {
    for (const body of [
      "not json",
      [],
      null,
      { external_item_id: "m1234", action: "dismissed", reason: "dup" },
      { external_item_id: "m12345678901,x", action: "photo_check_requested" },
      { external_item_id: 12345678901, action: "photo_check_requested" },
      // The deal tab's action is not a lead action.
      { external_item_id: "m12345678901", action: "recheck_requested" },
      { external_item_id: "m12345678901", action: "bought" },
      { external_item_id: "m12345678901", action: "dismissed", reason: "x".repeat(501) },
      { external_item_id: "m12345678901", action: "dismissed", reason: 42 },
    ]) {
      const response = await POST(request(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("records a dismissal with its trimmed reason through the caller session", async () => {
    const response = await POST(request({
      external_item_id: "m12345678901",
      action: "dismissed",
      reason: "  PSA10相当, not a slab  ",
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("record_mercari_lead_action", {
      p_external_item_id: "m12345678901",
      p_action: "dismissed",
      p_reason: "PSA10相当, not a slab",
    });
  });

  it("records a photo-check request with a null reason", async () => {
    const response = await POST(request({ external_item_id: "ABCDEFGHIJKLMNOPQRSTUV", action: "photo_check_requested" }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("record_mercari_lead_action", {
      p_external_item_id: "ABCDEFGHIJKLMNOPQRSTUV",
      p_action: "photo_check_requested",
      p_reason: null,
    });
  });

  it("maps the RPC refusals to statuses without leaking them", async () => {
    const cases: Array<[{ message: string; code?: string }, number]> = [
      [{ message: "Mercari lead actions require an active source-run operator" }, 403],
      [{ message: "Mercari lead m12345678901 is not published" }, 404],
      [{ message: "a Mercari lead dismissal requires a reason" }, 400],
      [{ message: "unsupported Mercari lead action bought" }, 400],
      [{ message: "new row violates check constraint", code: "23514" }, 409],
      [{ message: "connection reset" }, 500],
    ];
    for (const [error, status] of cases) {
      mocks.rpc.mockResolvedValue({ data: null, error });
      const response = await POST(request({ external_item_id: "m12345678901", action: "photo_check_requested" }));
      expect(response.status, error.message).toBe(status);
      expect(JSON.stringify(await response.json())).not.toContain(error.message);
    }
  });
});
