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
  return new NextRequest("http://fixture.local/api/mercari-deals/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("Mercari deal item action route", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.rpc.mockReset();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "operator" } } });
    mocks.rpc.mockResolvedValue({ data: { action_id: 1 }, error: null });
  });

  it("rejects unauthenticated requests without calling the RPC", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(request({ external_item_id: "m12345678901", action: "recheck_requested" }));

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("bounds the body before calling the RPC", async () => {
    for (const body of [
      "not json",
      [],
      { external_item_id: "m1234", action: "dismissed", reason: "dup" },
      { external_item_id: "m12345678901", action: "bought" },
      { external_item_id: "m12345678901", action: "dismissed" },
      { external_item_id: "m12345678901", action: "dismissed", reason: "   " },
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
      reason: "  wrong card, this is the promo  ",
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("record_mercari_deal_item_action", {
      p_external_item_id: "m12345678901",
      p_action: "dismissed",
      p_reason: "wrong card, this is the promo",
    });
  });

  it("records a recheck with a null reason", async () => {
    const response = await POST(request({ external_item_id: "ABCDEFGHIJKLMNOPQRSTUV", action: "recheck_requested" }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("record_mercari_deal_item_action", {
      p_external_item_id: "ABCDEFGHIJKLMNOPQRSTUV",
      p_action: "recheck_requested",
      p_reason: null,
    });
  });

  it("maps the RPC refusals to statuses", async () => {
    const cases: Array<[{ message: string; code?: string }, number]> = [
      [{ message: "Mercari item actions require an active source-run operator" }, 403],
      [{ message: "Mercari item m12345678901 does not exist" }, 404],
      [{ message: "new row violates check constraint", code: "23514" }, 409],
      [{ message: "connection reset" }, 500],
    ];
    for (const [error, status] of cases) {
      mocks.rpc.mockResolvedValue({ data: null, error });
      const response = await POST(request({ external_item_id: "m12345678901", action: "recheck_requested" }));
      expect(response.status, error.message).toBe(status);
    }
  });
});
