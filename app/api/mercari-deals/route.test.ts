// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = [method: string, args: unknown[]];

// A chainable stand-in for the PostgREST query builder. Every builder method
// records its arguments and returns the same object; awaiting it resolves to
// whatever the test queued as the response.
function fakeQuery(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const query: Record<string, unknown> = { calls };
  for (const method of ["select", "order", "limit", "eq", "or"]) {
    query[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      return query;
    };
  }
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return query as unknown as { calls: Call[] };
}

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
    from: mocks.from,
  }),
}));

import { DEAL_COLUMNS, nextCursor } from "./deals-query";
import { GET } from "./route";

function request(query = "") {
  return new NextRequest(`http://fixture.local/api/mercari-deals${query}`);
}

function row(id: string, observedAt: string) {
  return { external_item_id: id, observed_at: observedAt };
}

describe("protected Mercari deals route", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.rpc.mockReset();
    mocks.from.mockReset();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "operator" } } });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });

  it("rejects unauthenticated requests without touching the database", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("bounds every filter before asking the database anything", async () => {
    for (const query of [
      "?limit=0",
      "?limit=101",
      "?limit=nope",
      "?holder=slabbed",
      "?lane=loose",
      "?include_dismissed=maybe",
      "?before=nope&before_key=m12345678901",
      "?before=2026-10-22T06:59:14.653179+00:00",
      "?before_key=m12345678901",
      "?before=2026-10-22T06:59:14.653179+00:00&before_key=m1234",
      "?before=2026-10-22T06:59:14.653179+00:00&before_key=m12345678901,x",
      "?before=2026-10-22T06:59:14.653179+00:00)&before_key=m12345678901",
    ]) {
      const response = await GET(request(query));
      expect(response.status, query).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("refuses a non-operator with 403 before reading the view", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(mocks.rpc).toHaveBeenCalledWith("source_run_is_operator");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("reports an operator-check failure as unavailable", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("reads the view newest first, hides dismissed rows by default, and disables caching", async () => {
    const query = fakeQuery({ data: [row("m12345678901", "2026-10-22T06:59:14.653179+00:00")], error: null });
    mocks.from.mockReturnValue(query);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.from).toHaveBeenCalledWith("mercari_published_deals_v");
    expect(query.calls).toEqual([
      ["select", [DEAL_COLUMNS]],
      ["order", ["observed_at", { ascending: false }]],
      ["order", ["external_item_id", { ascending: true }]],
      ["limit", [50]],
      ["or", ["latest_item_action.is.null,latest_item_action.neq.dismissed"]],
    ]);
    const body = await response.json();
    expect(body.deals).toHaveLength(1);
    expect(body.next_cursor).toBeNull();
  });

  it("passes holder, lane, dismissed, and cursor filters through and builds the next cursor", async () => {
    const rows = [
      row("m11111111111", "2026-10-22T06:00:00+00:00"),
      row("m22222222222", "2026-10-22T05:00:00+00:00"),
    ];
    const query = fakeQuery({ data: rows, error: null });
    mocks.from.mockReturnValue(query);

    const response = await GET(request(
      "?holder=graded&lane=strict&include_dismissed=1&limit=2"
      + "&before=2026-10-22T07%3A00%3A00%2B00%3A00&before_key=m00000000000",
    ));

    expect(response.status).toBe(200);
    expect(query.calls).toEqual([
      ["select", [DEAL_COLUMNS]],
      ["order", ["observed_at", { ascending: false }]],
      ["order", ["external_item_id", { ascending: true }]],
      ["limit", [2]],
      ["eq", ["holder_kind", "graded"]],
      ["eq", ["evidence_lane", "strict"]],
      ["or", [
        "observed_at.lt.2026-10-22T07:00:00+00:00,"
        + "and(observed_at.eq.2026-10-22T07:00:00+00:00,external_item_id.gt.m00000000000)",
      ]],
    ]);
    const body = await response.json();
    expect(body.next_cursor).toEqual({
      before: "2026-10-22T05:00:00+00:00",
      before_key: "m22222222222",
    });
  });

  it("reports a view error as unavailable without leaking it", async () => {
    mocks.from.mockReturnValue(fakeQuery({ data: null, error: { message: "permission denied for view" } }));

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Mercari deals are unavailable" });
  });

  it("fails closed on a cursor boundary the view should never produce", () => {
    expect(nextCursor([row("m12345678901", "2026-10-22T06:00:00+00:00")], 1)).toEqual({
      before: "2026-10-22T06:00:00+00:00",
      before_key: "m12345678901",
    });
    expect(nextCursor([row("m12345678901", "2026-10-22T06:00:00+00:00")], 2)).toBeNull();
    expect(() => nextCursor([row("bad id", "2026-10-22T06:00:00+00:00")], 1)).toThrow("invalid cursor boundary");
    expect(() => nextCursor([row("m12345678901", "yesterday")], 1)).toThrow("invalid cursor boundary");
    expect(() => nextCursor(["not a row"], 1)).toThrow("invalid row");
  });
});
