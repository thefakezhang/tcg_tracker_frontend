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
  for (const method of ["select", "order", "limit", "eq", "neq", "is", "gt", "or"]) {
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

import { LEAD_COLUMNS, nextCursor, parseLeadsRequest } from "./leads-query";
import { GET } from "./route";

function request(query = "") {
  return new NextRequest(`http://fixture.local/api/mercari-leads${query}`);
}

function row(id: string, fields: Record<string, unknown>) {
  return { external_item_id: id, ...fields };
}

const DEFAULT_HIDING: Call[] = [
  ["eq", ["source_status", "ON_SALE"]],
  ["neq", ["photo_check_state", "rejected"]],
  ["eq", ["dismissed", false]],
];

describe("protected Mercari leads route", () => {
  beforeEach(() => {
    mocks.getUser.mockReset();
    mocks.rpc.mockReset();
    mocks.from.mockReset();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "operator" } } });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });

  it("rejects unauthenticated requests without touching the database", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await GET(request("?lane=psa"));

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("requires exactly one lane, so lanes never mix", async () => {
    for (const query of ["", "?lane=", "?lane=raw", "?lane=psa,modern_raw", "?lane=PSA"]) {
      const response = await GET(request(query));
      expect(response.status, query).toBe(400);
      expect((await response.json()).error).toContain("lane is required");
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("bounds every other parameter before asking the database anything", async () => {
    for (const query of [
      "?lane=psa&limit=0",
      "?lane=psa&limit=101",
      "?lane=psa&limit=nope",
      "?lane=psa&sort=price",
      "?lane=psa&photo=verified",
      "?lane=psa&include_dismissed=maybe",
      "?lane=psa&include_unavailable=yes",
      // A cursor needs both halves, a safe id, and a key of the sort's type.
      "?lane=psa&after=2.5",
      "?lane=psa&after_key=m12345678901",
      "?lane=psa&after=2.5&after_key=m1234",
      "?lane=psa&after=2.5&after_key=m12345678901,x",
      "?lane=psa&after=-1&after_key=m12345678901",
      "?lane=psa&after=2.5)&after_key=m12345678901",
      "?lane=psa&after=2.5000&after_key=m12345678901",
      "?lane=psa&after=2026-10-28T03:00:00%2B00:00&after_key=m12345678901",
      "?lane=psa&sort=newest&after=2.5&after_key=m12345678901",
      "?lane=psa&sort=newest&after=null&after_key=m12345678901",
      "?lane=psa&sort=newest&after=2026-10-28T03:00:00%2B00:00)&after_key=m12345678901",
    ]) {
      const response = await GET(request(query));
      expect(response.status, query).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("refuses a non-operator with 403 before reading the view", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    const response = await GET(request("?lane=psa"));

    expect(response.status).toBe(403);
    expect(mocks.rpc).toHaveBeenCalledWith("source_run_is_operator");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("reports an operator-check failure as unavailable", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    const response = await GET(request("?lane=psa"));

    expect(response.status).toBe(500);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("reads one lane by best multiple on the multiple index, hides unavailable, rejected and dismissed leads, and disables caching", async () => {
    const query = fakeQuery({ data: [row("m12345678901", { multiple: 2.5 })], error: null });
    mocks.from.mockReturnValue(query);

    const response = await GET(request("?lane=vintage_raw"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.from).toHaveBeenCalledWith("mercari_leads_v");
    expect(query.calls).toEqual([
      ["select", [LEAD_COLUMNS]],
      ["eq", ["lane", "vintage_raw"]],
      ["order", ["multiple", { ascending: false, nullsFirst: false }]],
      ["order", ["external_item_id", { ascending: true }]],
      ["limit", [50]],
      ...DEFAULT_HIDING,
    ]);
    const body = await response.json();
    expect(body.leads).toHaveLength(1);
    expect(body.next_cursor).toBeNull();
  });

  it("reads the newest first on the first-seen index", async () => {
    const query = fakeQuery({ data: [], error: null });
    mocks.from.mockReturnValue(query);

    const response = await GET(request("?lane=unpriced&sort=newest"));

    expect(response.status).toBe(200);
    expect(query.calls).toEqual([
      ["select", [LEAD_COLUMNS]],
      ["eq", ["lane", "unpriced"]],
      ["order", ["first_seen_at", { ascending: false }]],
      ["order", ["external_item_id", { ascending: true }]],
      ["limit", [50]],
      ...DEFAULT_HIDING,
    ]);
  });

  it("filters to one photo state and lifts each hidden-by-default rule only when asked", async () => {
    const query = fakeQuery({ data: [], error: null });
    mocks.from.mockReturnValue(query);

    await GET(request("?lane=psa&photo=rejected&include_dismissed=1&include_unavailable=true&limit=10"));

    expect(query.calls).toEqual([
      ["select", [LEAD_COLUMNS]],
      ["eq", ["lane", "psa"]],
      ["order", ["multiple", { ascending: false, nullsFirst: false }]],
      ["order", ["external_item_id", { ascending: true }]],
      ["limit", [10]],
      ["eq", ["photo_check_state", "rejected"]],
    ]);

    const conflicts = fakeQuery({ data: [], error: null });
    mocks.from.mockReturnValue(conflicts);
    await GET(request("?lane=psa&photo=conflict"));
    expect(conflicts.calls.slice(5)).toEqual([
      ["eq", ["source_status", "ON_SALE"]],
      ["eq", ["photo_check_state", "conflict"]],
      ["eq", ["dismissed", false]],
    ]);
  });

  it("continues a best-multiple page after a priced row, keeping the rows without a multiple last", async () => {
    const rows = [row("m11111111111", { multiple: 3.25 }), row("m22222222222", { multiple: 2.1 })];
    const query = fakeQuery({ data: rows, error: null });
    mocks.from.mockReturnValue(query);

    const response = await GET(request("?lane=modern_raw&limit=2&after=4.5&after_key=m00000000000"));

    expect(response.status).toBe(200);
    expect(query.calls.at(-1)).toEqual([
      "or",
      ["multiple.lt.4.5,and(multiple.eq.4.5,external_item_id.gt.m00000000000),multiple.is.null"],
    ]);
    expect((await response.json()).next_cursor).toEqual({ after: "2.1", after_key: "m22222222222" });
  });

  it("continues a best-multiple page inside the rows without a multiple", async () => {
    const rows = [row("m11111111111", { multiple: null }), row("m22222222222", { multiple: null })];
    const query = fakeQuery({ data: rows, error: null });
    mocks.from.mockReturnValue(query);

    const response = await GET(request("?lane=psa&limit=2&after=null&after_key=m00000000000"));

    expect(query.calls.slice(-2)).toEqual([
      ["is", ["multiple", null]],
      ["gt", ["external_item_id", "m00000000000"]],
    ]);
    expect((await response.json()).next_cursor).toEqual({ after: null, after_key: "m22222222222" });
  });

  it("continues a newest page by first-seen time and id", async () => {
    const rows = [
      row("m11111111111", { first_seen_at: "2026-10-28T06:00:00+00:00" }),
      row("ABCDEFGHIJKLMNOPQRSTUV", { first_seen_at: "2026-10-28T05:00:00.123456+00:00" }),
    ];
    const query = fakeQuery({ data: rows, error: null });
    mocks.from.mockReturnValue(query);

    const response = await GET(request(
      "?lane=psa&sort=newest&limit=2&after=2026-10-28T07%3A00%3A00%2B00%3A00&after_key=m00000000000",
    ));

    expect(query.calls.at(-1)).toEqual([
      "or",
      ["first_seen_at.lt.2026-10-28T07:00:00+00:00,"
        + "and(first_seen_at.eq.2026-10-28T07:00:00+00:00,external_item_id.gt.m00000000000)"],
    ]);
    expect((await response.json()).next_cursor).toEqual({
      after: "2026-10-28T05:00:00.123456+00:00",
      after_key: "ABCDEFGHIJKLMNOPQRSTUV",
    });
  });

  it("reports a view error as unavailable without leaking it", async () => {
    mocks.from.mockReturnValue(fakeQuery({ data: null, error: { message: "relation mercari_leads_v does not exist" } }));

    const response = await GET(request("?lane=psa"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Mercari leads are unavailable" });
  });

  it("reports an unusable cursor boundary as unavailable instead of a broken cursor", async () => {
    mocks.from.mockReturnValue(fakeQuery({ data: [row("m12345678901", { multiple: "lots" })], error: null }));

    const response = await GET(request("?lane=psa&limit=1"));

    expect(response.status).toBe(500);
  });
});

describe("Mercari leads request and cursor", () => {
  it("defaults to best multiple, every photo state but rejected, and 50 rows", () => {
    expect(parseLeadsRequest(new URLSearchParams("lane=psa"))).toEqual({
      ok: true,
      value: {
        lane: "psa",
        sort: "multiple",
        photo: null,
        includeDismissed: false,
        includeUnavailable: false,
        cursor: null,
        limit: 50,
      },
    });
  });

  it("fails closed on a cursor boundary the view should never produce", () => {
    expect(nextCursor([row("m12345678901", { multiple: 2.5 })], 1, "multiple")).toEqual({
      after: "2.5",
      after_key: "m12345678901",
    });
    expect(nextCursor([row("m12345678901", { multiple: "12.125" })], 1, "multiple")).toEqual({
      after: "12.125",
      after_key: "m12345678901",
    });
    expect(nextCursor([row("m12345678901", { multiple: null })], 1, "multiple")).toEqual({
      after: null,
      after_key: "m12345678901",
    });
    expect(nextCursor([row("m12345678901", { multiple: 2.5 })], 2, "multiple")).toBeNull();
    expect(() => nextCursor([row("m12345678901", {})], 1, "multiple")).toThrow("invalid cursor boundary");
    expect(() => nextCursor([row("m12345678901", { multiple: -1 })], 1, "multiple")).toThrow("invalid cursor boundary");
    expect(() => nextCursor([row("bad id", { multiple: 2 })], 1, "multiple")).toThrow("invalid cursor boundary");
    expect(() => nextCursor([row("m12345678901", { first_seen_at: "yesterday" })], 1, "newest")).toThrow("invalid cursor boundary");
    expect(() => nextCursor(["not a row"], 1, "newest")).toThrow("invalid row");
  });
});
