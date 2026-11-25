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
  for (const method of ["select", "order", "limit", "eq", "neq", "is", "not", "gt", "or", "in"]) {
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

// One row of mercari_lead_groups (backend 000638): a group of one by default.
function group(id: string, fields: Record<string, unknown> = {}) {
  return {
    external_item_id: id,
    group_rows: 1,
    group_listings: 1,
    group_ask_min_jpy: 1000,
    group_ask_max_jpy: 1000,
    group_member_ids: [id],
    multiple: null,
    first_seen_at: "2026-10-28T06:00:00+00:00",
    auction_ends_at: null,
    ...fields,
  };
}

// The operator check passes, the grouped feed answers groups, and the view
// answers rows (or an error).
function serve(groups: unknown[], rows: unknown[] | null, error: unknown = null) {
  mocks.rpc.mockImplementation(async (name: string) => (
    name === "source_run_is_operator" ? { data: true, error: null } : { data: groups, error: null }
  ));
  const query = fakeQuery({ data: rows, error });
  mocks.from.mockReturnValue(query);
  return query;
}

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

  it("reads one lane's grouped feed, then its representatives in full, in the feed's order, without caching", async () => {
    const query = serve(
      [
        group("m11111111111", { group_rows: 2, group_listings: 2, group_ask_max_jpy: 1500, group_member_ids: ["m11111111111", "m33333333333"], multiple: 4.328 }),
        group("m22222222222", { multiple: 2.1 }),
      ],
      [row("m22222222222", { multiple: 2.1 }), row("m11111111111", { multiple: 4.328 })],
    );

    const response = await GET(request("?lane=vintage_raw"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenCalledWith("mercari_lead_groups", {
      p_lane: "vintage_raw",
      p_format: "fixed_price",
      p_sort: "multiple",
      p_photo: null,
      p_include_unavailable: false,
      p_include_dismissed: false,
      p_include_evidence: false,
      p_include_screened: false,
      p_include_shops: false,
      p_limit: 50,
    });
    expect(mocks.from).toHaveBeenCalledWith("mercari_leads_v");
    expect(query.calls).toEqual([
      ["select", [LEAD_COLUMNS]],
      ["eq", ["lane", "vintage_raw"]],
      ["is", ["kept_for", null]],
      ["in", ["external_item_id", ["m11111111111", "m22222222222"]]],
    ]);
    const body = await response.json();
    expect(body.leads.map((lead: { external_item_id: string }) => lead.external_item_id)).toEqual(["m11111111111", "m22222222222"]);
    expect(body.leads[0]).toMatchObject({
      group_rows: 2,
      group_listings: 2,
      group_ask_min_jpy: 1000,
      group_ask_max_jpy: 1500,
      group_member_ids: ["m11111111111", "m33333333333"],
    });
    expect(body.next_cursor).toBeNull();
  });

  it("reads the mid-era lane as its own lane (#2905)", async () => {
    const query = serve([group("m11111111111", { multiple: 1.905 })], [row("m11111111111", { multiple: 1.905 })]);

    const response = await GET(request("?lane=mid_raw"));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("mercari_lead_groups", expect.objectContaining({ p_lane: "mid_raw" }));
    expect(query.calls).toContainEqual(["eq", ["lane", "mid_raw"]]);
  });

  it("passes every filter and toggle to the grouped feed", async () => {
    serve([], []);

    await GET(request(
      "?lane=psa&photo=rejected&include_dismissed=1&include_unavailable=true&include_evidence=1"
        + "&include_screened=true&include_shops=1&sort=newest&limit=10",
    ));

    expect(mocks.rpc).toHaveBeenCalledWith("mercari_lead_groups", {
      p_lane: "psa",
      p_format: "fixed_price",
      p_sort: "newest",
      p_photo: "rejected",
      p_include_unavailable: true,
      p_include_dismissed: true,
      p_include_evidence: true,
      p_include_screened: true,
      p_include_shops: true,
      p_limit: 10,
    });
    // No group, so no representative to read.
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("hands each sort's cursor to the grouped feed as its typed boundary", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["?lane=modern_raw&after=4.5&after_key=m00000000000", { p_after_key: "m00000000000", p_after_multiple: "4.5" }],
      ["?lane=psa&after=null&after_key=m00000000000", { p_after_key: "m00000000000", p_after_null: true }],
      [
        "?lane=psa&sort=newest&after=2026-10-28T07%3A00%3A00%2B00%3A00&after_key=m00000000000",
        { p_after_key: "m00000000000", p_after_time: "2026-10-28T07:00:00+00:00" },
      ],
      [
        "?lane=psa&format=auction&after=2026-11-08T10%3A00%3A00%2B00%3A00&after_key=m00000000000"
          + "&after_seen=2026-11-07T10%3A00%3A00%2B00%3A00",
        { p_after_key: "m00000000000", p_after_time: "2026-11-08T10:00:00+00:00", p_after_seen: "2026-11-07T10:00:00+00:00" },
      ],
      [
        "?lane=psa&format=auction&after=null&after_key=m22222222222&after_seen=2026-11-07T08%3A00%3A00%2B00%3A00",
        { p_after_key: "m22222222222", p_after_null: true, p_after_seen: "2026-11-07T08:00:00+00:00" },
      ],
    ];
    for (const [query, boundary] of cases) {
      mocks.rpc.mockClear();
      serve([], []);
      await GET(request(query));
      const [, args] = mocks.rpc.mock.calls.find(([name]) => name === "mercari_lead_groups") ?? [];
      expect(args, query).toMatchObject(boundary);
      for (const key of ["p_after_multiple", "p_after_time", "p_after_seen", "p_after_null"]) {
        if (!(key in boundary)) expect(args, `${query} ${key}`).not.toHaveProperty(key);
      }
    }
  });

  it("builds the next cursor from the last group, even when its row left the view between the reads", async () => {
    serve(
      [group("m11111111111", { multiple: 3.25 }), group("m22222222222", { multiple: 2.1 })],
      [row("m11111111111", { multiple: 3.25 })],
    );

    const response = await GET(request("?lane=modern_raw&limit=2"));

    const body = await response.json();
    expect(body.leads).toHaveLength(1);
    expect(body.next_cursor).toEqual({ after: "2.1", after_key: "m22222222222" });

    serve(
      [
        group("m11111111111", { auction_ends_at: "2026-11-08T11:00:00+00:00", first_seen_at: "2026-11-07T09:00:00+00:00" }),
        group("m22222222222", { auction_ends_at: null, first_seen_at: "2026-11-07T08:00:00+00:00" }),
      ],
      [],
    );
    const auctions = await GET(request("?lane=psa&format=auction&limit=2"));
    expect((await auctions.json()).next_cursor).toEqual({
      after: null,
      after_key: "m22222222222",
      after_seen: "2026-11-07T08:00:00+00:00",
    });
  });

  it("reads a group's members in full, in the order asked, for an expansion", async () => {
    const query = serve([], [row("m33333333333", {}), row("m11111111111", {})]);

    const response = await GET(request("?lane=vintage_raw&ids=m11111111111,m22222222222,m33333333333"));

    expect(response.status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalledWith("mercari_lead_groups", expect.anything());
    expect(query.calls).toEqual([
      ["select", [LEAD_COLUMNS]],
      ["eq", ["lane", "vintage_raw"]],
      ["is", ["kept_for", null]],
      ["in", ["external_item_id", ["m11111111111", "m22222222222", "m33333333333"]]],
    ]);
    const body = await response.json();
    expect(body.leads.map((lead: { external_item_id: string }) => lead.external_item_id)).toEqual(["m11111111111", "m33333333333"]);
    expect(body.next_cursor).toBeNull();
  });

  it("bounds a group's members before reading them", async () => {
    const many = Array.from({ length: 101 }, (_, index) => `m${String(10000000000 + index)}`).join(",");
    for (const query of [
      `?lane=psa&ids=${many}`,
      "?lane=psa&ids=m11111111111,bad",
      "?lane=psa&ids=m11111111111,m11111111111",
      "?lane=psa&ids=m11111111111&after=2.5&after_key=m22222222222",
      "?ids=m11111111111",
      "?lane=psa&include_evidence=yes",
      "?lane=psa&include_screened=2",
      "?lane=psa&include_shops=no",
    ]) {
      const response = await GET(request(query));
      expect(response.status, query).toBe(400);
    }
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("offers each format only its own sorts and cursor", async () => {
    for (const query of [
      "?lane=psa&format=auctions",
      "?lane=psa&format=auction&sort=multiple",
      "?lane=psa&sort=ending",
      // An ending cursor needs a stated end or null, and the first sighting.
      "?lane=psa&format=auction&after=2026-11-08T11:00:00%2B00:00&after_key=m12345678901",
      "?lane=psa&format=auction&after=soon&after_key=m12345678901&after_seen=2026-11-07T10:00:00%2B00:00",
      "?lane=psa&format=auction&after=null&after_key=m12345678901&after_seen=yesterday",
      "?lane=psa&format=auction&after=null&after_key=m12345678901&after_seen=2026-11-07T10:00:00%2B00:00)",
      "?lane=psa&sort=newest&after=2026-10-28T03:00:00%2B00:00&after_key=m12345678901&after_seen=2026-11-07T10:00:00%2B00:00",
    ]) {
      const response = await GET(request(query));
      expect(response.status, query).toBe(400);
    }
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("reports a grouped-feed, view or shape error as unavailable without leaking it", async () => {
    mocks.rpc.mockImplementation(async (name: string) => (
      name === "source_run_is_operator"
        ? { data: true, error: null }
        : { data: null, error: { message: "function mercari_lead_groups does not exist" } }
    ));
    let response = await GET(request("?lane=psa"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Mercari leads are unavailable" });

    serve([group("m12345678901")], null, { message: "relation mercari_leads_v does not exist" });
    response = await GET(request("?lane=psa"));
    expect(response.status).toBe(500);

    // A group whose members do not start with it, or whose counts disagree.
    for (const broken of [
      group("m12345678901", { group_member_ids: ["m22222222222"] }),
      group("m12345678901", { group_rows: 2 }),
      group("m12345678901", { group_ask_min_jpy: 2000 }),
    ]) {
      serve([broken], []);
      response = await GET(request("?lane=psa"));
      expect(response.status).toBe(500);
    }
  });

  it("reports an unusable cursor boundary as unavailable instead of a broken cursor", async () => {
    serve([group("m12345678901", { multiple: "lots" })], [row("m12345678901", {})]);

    const response = await GET(request("?lane=psa&limit=1"));

    expect(response.status).toBe(500);
  });
});

// mercari_leads_v's columns as backend migration 000638 defines them, in
// order (the backend pins the same list in TestMercariLeadsViewColumns).
// PostgREST answers a select naming a missing column with a 400, so the route
// must never ask for anything outside it.
const VIEW_COLUMNS_000648 = [
  "platform", "external_item_id", "publication_id", "publication_published_at", "published_at",
  "source_kind", "source_run_id", "source_item_type", "canonical_url", "sanitized_title", "ask_jpy",
  "shipping_payer_id", "shipping_payer", "buyer_pays_shipping", "shipping_method_id", "shipping_added_jpy",
  "seller_condition_id", "source_status", "source_created_at", "first_seen_at", "observed_at",
  "listing_age_hours", "observed_age_hours", "freshness_status", "holder_hint", "title_psa_grade",
  "frontier_key", "frontier_state", "scheduling_condition", "queue_status", "candidate_count", "ambiguous",
  "source_candidate_uids", "resolved_candidate_uids", "source_card_uid", "current_card_uid", "card_uid",
  "card_resolution", "card_id", "regional_name", "english_name", "set_code", "set_name", "set_release_date",
  "card_number", "misc_info", "image_url", "lane", "value_usd", "value_psa_grade", "value_basis",
  "value_as_of", "value_sample_count", "value_window_days", "unpriced_reason", "jpy_to_usd_rate",
  "buyer_paid_shipping_jpy", "landed_ask_usd", "selling_cost_usd", "net_value_usd", "multiple",
  "multiple_withheld_reason", "other_listings", "photo_check_state", "photo_source_card_uid",
  "photo_card_uid", "photo_regional_name", "photo_english_name", "photo_set_code", "photo_card_number",
  "photo_image_url", "photo_psa_grade", "photo_checked_at", "latest_lead_action",
  "latest_lead_action_reason", "latest_lead_action_at", "dismissed", "photo_check_requested", "edition",
  "foil_treatment", "match_tier", "title_card_in_photo_scope", "value_condition", "nm_value_usd",
  "photo_check_priority", "listing_format", "auction_bid_count", "auction_ends_at", "auction_last_seen_at",
  "auction_max_bid_jpy", "auction_bid_within_max", "auction_ended", "photo_checks_paused",
  "current_publication_id", "value_refreshed_at", "value_age_days", "screen_result", "screen_evidence_usd",
  "screen_evidence_source", "screen_evidence_as_of", "screen_multiplier",
  // 000646 (#2707): the slab play.
  "slab_floor_usd", "slab_floor_median_usd", "slab_floor_sales", "slab_floor_grades", "slab_floor_as_of",
  "slab_grading_cost_usd", "slab_grading_days", "slab_selling_cost_usd", "slab_net_value_usd",
  "slab_play_profit_usd", "slab_play_multiple", "slab_play_state",
  // 000648 (#2710): a row kept only as a slab play.
  "kept_for",
  // 000653 (#2755): the PSA service level a slab play is graded at.
  "slab_grading_service_level", "slab_grading_business_days_min", "slab_grading_business_days_max",
  "on_sale_confirmed_at",
];

describe("Mercari leads column list", () => {
  it("selects only columns mercari_leads_v has, each once, including the source kind and the photo-check band", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "operator" } } });
    const query = serve([group("m12345678901")], []);

    await GET(request("?lane=modern_raw"));

    const [method, [selected]] = query.calls[0];
    expect(method).toBe("select");
    const columns = String(selected).split(", ");
    expect(columns).toContain("source_kind");
    expect(columns).toContain("photo_check_priority");
    expect(new Set(columns).size).toBe(columns.length);
    expect(columns).toContain("listing_format");
    expect(columns).toContain("auction_max_bid_jpy");
    expect(columns).toContain("photo_checks_paused");
    expect(columns).toContain("screen_result");
    expect(columns).toContain("value_age_days");
    expect(columns.filter((column) => !VIEW_COLUMNS_000648.includes(column))).toEqual([]);
  });
});

describe("Mercari leads request and cursor", () => {
  it("defaults to best multiple, every photo state but rejected, and 50 rows", () => {
    expect(parseLeadsRequest(new URLSearchParams("lane=psa"))).toEqual({
      ok: true,
      value: {
        lane: "psa",
        format: "fixed_price",
        sort: "multiple",
        photo: null,
        includeDismissed: false,
        includeUnavailable: false,
        includeEvidence: false,
        includeScreened: false,
        includeShops: false,
        conditions: null,
        includeUnverified: false,
        cursor: null,
        limit: 50,
        ids: null,
      },
    });
  });

  it("fails closed on a cursor boundary the view should never produce", () => {
    expect(nextCursor([row("m12345678901", { multiple: 2.5 })], 1, "multiple", "psa")).toEqual({
      after: "2.5",
      after_key: "m12345678901",
    });
    expect(nextCursor([row("m12345678901", { multiple: "12.125" })], 1, "multiple", "psa")).toEqual({
      after: "12.125",
      after_key: "m12345678901",
    });
    expect(nextCursor([row("m12345678901", { multiple: null })], 1, "multiple", "psa")).toEqual({
      after: null,
      after_key: "m12345678901",
    });
    expect(nextCursor([row("m12345678901", { multiple: 2.5 })], 2, "multiple", "psa")).toBeNull();
    expect(() => nextCursor([row("m12345678901", {})], 1, "multiple", "psa")).toThrow("invalid cursor boundary");
    expect(() => nextCursor([row("m12345678901", { multiple: -1 })], 1, "multiple", "psa")).toThrow("invalid cursor boundary");
    expect(() => nextCursor([row("bad id", { multiple: 2 })], 1, "multiple", "psa")).toThrow("invalid cursor boundary");
    expect(() => nextCursor([row("m12345678901", { first_seen_at: "yesterday" })], 1, "newest", "psa")).toThrow("invalid cursor boundary");
    expect(() => nextCursor(["not a row"], 1, "newest", "psa")).toThrow("invalid row");
    expect(nextCursor([row("m12345678901", {
      auction_ends_at: "2026-11-08T11:00:00+00:00", first_seen_at: "2026-11-07T09:00:00+00:00",
    })], 1, "ending", "psa")).toEqual({
      after: "2026-11-08T11:00:00+00:00", after_key: "m12345678901", after_seen: "2026-11-07T09:00:00+00:00",
    });
    expect(() => nextCursor([row("m12345678901", { first_seen_at: "2026-11-07T09:00:00+00:00" })], 1, "ending", "psa"))
      .toThrow("invalid cursor boundary");
    expect(() => nextCursor([row("m12345678901", { auction_ends_at: "soon", first_seen_at: "2026-11-07T09:00:00+00:00" })], 1, "ending", "psa"))
      .toThrow("invalid cursor boundary");
  });

  it("defaults an auction feed to ending soonest", () => {
    const parsed = parseLeadsRequest(new URLSearchParams("lane=psa&format=auction"));
    expect(parsed.ok && parsed.value.format === "auction" && parsed.value.sort === "ending").toBe(true);
  });
});

describe("slab plays and the seller's condition (backend 000646)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "operator" } } });
  });

  it("reads the slab plays by profit, and their rows as slab plays rather than by row lane", async () => {
    const query = serve(
      [group("m12345678901", { slab_play_profit_usd: 213.53, seller_condition_id: "5" })],
      [row("m12345678901", { lane: "unpriced", slab_play_state: "play" })],
    );

    const response = await GET(request("?lane=slab_play&limit=1"));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("mercari_lead_groups", expect.objectContaining({
      p_lane: "slab_play",
      p_format: "fixed_price",
      p_sort: "profit",
    }));
    expect(query.calls).toContainEqual(["not", ["slab_play_state", "is", null]]);
    expect(query.calls.some(([method]) => method === "eq")).toBe(false);
    // A row kept below the raw bars (backend 000648) belongs here.
    expect(query.calls).not.toContainEqual(["is", ["kept_for", null]]);
    const body = await response.json();
    expect(body.next_cursor).toEqual({ after: "213.53", after_key: "m12345678901" });
  });

  it("never reads a row kept only as a slab play into an ordinary lane, even by id", async () => {
    const feed = serve([group("m12345678901")], [row("m12345678901", { lane: "vintage_raw" })]);
    await GET(request("?lane=vintage_raw"));
    expect(feed.calls).toContainEqual(["eq", ["lane", "vintage_raw"]]);
    expect(feed.calls).toContainEqual(["is", ["kept_for", null]]);

    const members = serve([], [row("m12345678901", { lane: "vintage_raw" })]);
    await GET(request("?lane=vintage_raw&ids=m12345678901"));
    expect(members.calls).toContainEqual(["is", ["kept_for", null]]);
  });

  it("sends the conditions and the unverified toggle only when they say something", async () => {
    serve([], []);
    await GET(request("?lane=slab_play&conditions=1,3&include_unverified=1"));
    expect(mocks.rpc).toHaveBeenCalledWith("mercari_lead_groups", expect.objectContaining({
      p_conditions: ["1", "3"],
      p_include_unverified: true,
    }));

    mocks.rpc.mockClear();
    serve([], []);
    await GET(request("?lane=modern_raw"));
    const [, args] = mocks.rpc.mock.calls.find(([name]) => name === "mercari_lead_groups") ?? [];
    expect(args).not.toHaveProperty("p_conditions");
    expect(args).not.toHaveProperty("p_include_unverified");
  });

  it("hands the profit and condition cursors to the grouped feed as their typed boundaries", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["?lane=slab_play&after=66.3&after_key=m00000000000", { p_after_key: "m00000000000", p_after_profit: "66.3" }],
      [
        "?lane=slab_play&sort=condition&after=66.3&after_key=m00000000000&after_condition=2",
        { p_after_key: "m00000000000", p_after_condition: "2", p_after_profit: "66.3" },
      ],
      [
        "?lane=modern_raw&sort=condition&after=4.5&after_key=m00000000000&after_condition=1",
        { p_after_key: "m00000000000", p_after_condition: "1", p_after_multiple: "4.5" },
      ],
      [
        "?lane=modern_raw&sort=condition&after=null&after_key=m00000000000&after_condition=3",
        { p_after_key: "m00000000000", p_after_condition: "3", p_after_null: true },
      ],
    ];
    for (const [query, boundary] of cases) {
      mocks.rpc.mockClear();
      serve([], []);
      const response = await GET(request(query));
      expect(response.status, query).toBe(200);
      const [, args] = mocks.rpc.mock.calls.find(([name]) => name === "mercari_lead_groups") ?? [];
      expect(args, query).toMatchObject(boundary);
      for (const key of ["p_after_multiple", "p_after_profit", "p_after_condition", "p_after_null", "p_after_time"]) {
        if (!(key in boundary)) expect(args, `${query} ${key}`).not.toHaveProperty(key);
      }
    }
  });

  it("refuses what the grouped feed would refuse, before asking it", async () => {
    for (const query of [
      "?lane=slab_plays",
      "?lane=slab_play&format=auction",
      "?lane=slab_play&sort=multiple",
      "?lane=modern_raw&sort=profit",
      "?lane=psa&format=auction&sort=condition",
      "?lane=psa&conditions=7",
      "?lane=psa&conditions=1,1",
      "?lane=psa&conditions=1,,2",
      "?lane=modern_raw&include_unverified=1",
      // A profit is never null, and a condition cursor names its condition.
      "?lane=slab_play&after=null&after_key=m12345678901",
      "?lane=slab_play&sort=condition&after=null&after_key=m12345678901&after_condition=2",
      "?lane=modern_raw&sort=condition&after=4.5&after_key=m12345678901",
      "?lane=modern_raw&sort=condition&after=4.5&after_key=m12345678901&after_condition=9",
      "?lane=modern_raw&after=4.5&after_key=m12345678901&after_condition=1",
      "?lane=slab_play&ids=m12345678901&after_condition=1",
    ]) {
      const response = await GET(request(query));
      expect(response.status, query).toBe(400);
    }
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("builds a condition cursor from the representative's condition and its lane's value", () => {
    expect(nextCursor([row("m12345678901", { seller_condition_id: "2", multiple: 3.25 })], 1, "condition", "modern_raw"))
      .toEqual({ after: "3.25", after_key: "m12345678901", after_condition: "2" });
    expect(nextCursor([row("m12345678901", { seller_condition_id: "3", multiple: null })], 1, "condition", "modern_raw"))
      .toEqual({ after: null, after_key: "m12345678901", after_condition: "3" });
    expect(nextCursor([row("m12345678901", { seller_condition_id: "2", slab_play_profit_usd: 66.3, multiple: null })], 1, "condition", "slab_play"))
      .toEqual({ after: "66.3", after_key: "m12345678901", after_condition: "2" });
    expect(() => nextCursor([row("m12345678901", { seller_condition_id: "2", slab_play_profit_usd: null })], 1, "profit", "slab_play"))
      .toThrow("invalid cursor boundary");
    expect(() => nextCursor([row("m12345678901", { seller_condition_id: "8", multiple: 2 })], 1, "condition", "modern_raw"))
      .toThrow("invalid cursor boundary");
    expect(() => nextCursor([row("m12345678901", { slab_play_profit_usd: -4 })], 1, "profit", "slab_play"))
      .toThrow("invalid cursor boundary");
  });
});
