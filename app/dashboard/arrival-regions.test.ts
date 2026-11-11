import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ArrivalRegionRequestError,
  addTokyoDays,
  focusRegions,
  loadRegionStatus,
  needsReadOnce,
  parseRegionStatus,
  regionReadState,
  sendRegionAction,
  withinShopHours,
} from "./arrival-regions";

const ROW = {
  region: "osaka",
  position: 10,
  default_focus: false,
  in_focus: false,
  focus_kind: "off",
  focus_until: null,
  focus_set_by: null,
  focus_set_at: null,
  in_focus_last_run: false,
  lists: 1,
  readable_lists: 1,
  shops: 24,
  list_only_shops: 24,
  last_read_at: null,
  pending_request: { request_id: 5, requested_at: "2026-11-02T04:59:00+00:00", requested_by: "op@example.test" },
  last_fulfilled: null,
};

const STATUS = {
  today: "2026-11-02",
  focus_source: "default",
  published_at: "2026-11-02T04:00:00+00:00",
  published_run_id: "2026-11-02T04:00:00+00:00",
  last_run_focus_source: "default",
  regions: [
    ROW,
    { ...ROW, region: "akihabara", position: 0, default_focus: true, in_focus: true,
      focus_kind: "default", lists: 2, readable_lists: 2, pending_request: null },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseRegionStatus", () => {
  it("reads the RPC's status in the roster's order", () => {
    const status = parseRegionStatus(STATUS);
    expect(status.regions.map((region) => region.region)).toEqual(["akihabara", "osaka"]);
    expect(status.regions[1].pending_request).toEqual(ROW.pending_request);
    expect(focusRegions(status).map((region) => region.region)).toEqual(["akihabara"]);
  });

  it.each([
    ["an unknown focus kind", { regions: [{ ...ROW, focus_kind: "maybe" }] }],
    ["more readable lists than lists", { regions: [{ ...ROW, readable_lists: 2 }] }],
    ["a malformed date", { regions: [{ ...ROW, focus_until: "11/10/2026" }] }],
    ["a region key that is not one", { regions: [{ ...ROW, region: "Osaka!" }] }],
    ["a pending request without its time", { regions: [{ ...ROW, pending_request: { request_id: 5 } }] }],
    ["a focus source the backend does not send", { focus_source: "trip" }],
    ["a missing date", { today: null }],
  ])("refuses %s", (_name, change) => {
    expect(() => parseRegionStatus({ ...STATUS, ...change })).toThrow(/Invalid region status/);
  });
});

describe("how the run reads a region", () => {
  const region = parseRegionStatus({ today: "2026-11-02", focus_source: "default", published_at: null, regions: [ROW] }).regions[0];
  const idle = { ...region, pending_request: null };
  const at = (iso: string) => Date.parse(iso);

  it("knows the shop hours, 11:00 through 20:00 Tokyo time", () => {
    expect(withinShopHours(at("2026-11-02T01:59:00Z"))).toBe(false); // 10:59 JST
    expect(withinShopHours(at("2026-11-02T02:00:00Z"))).toBe(true); // 11:00
    expect(withinShopHours(at("2026-11-02T11:00:00Z"))).toBe(true); // 20:00
    expect(withinShopHours(at("2026-11-02T11:01:00Z"))).toBe(false); // 20:01
  });

  it("reads hourly in focus, reading while a request is pending, queued only after five minutes outside shop hours", () => {
    expect(regionReadState({ ...region, in_focus: true }, at("2026-11-02T05:00:00Z"))).toBe("hourly");
    // Requested 04:59 UTC (13:59 JST): reading, in shop hours, however long it waits.
    expect(regionReadState(region, at("2026-11-02T05:00:00Z"))).toBe("reading");
    expect(regionReadState(region, at("2026-11-02T06:00:00Z"))).toBe("reading");
    const late = { ...region, pending_request: { ...region.pending_request!, requested_at: "2026-11-02T13:00:00Z" } };
    // 22:00 JST: reading for five minutes, then queued for the next run in shop hours.
    expect(regionReadState(late, at("2026-11-02T13:05:00Z"))).toBe("reading");
    expect(regionReadState(late, at("2026-11-02T13:05:01Z"))).toBe("queued");
    expect(regionReadState(idle, at("2026-11-02T05:00:00Z"))).toBe("idle");
    expect(regionReadState({ ...idle, readable_lists: 0 }, at("2026-11-02T05:00:00Z"))).toBe("nolist");
  });

  it("asks for a read only for a region not in focus, with nothing pending and a list to read", () => {
    expect(needsReadOnce(idle)).toBe(true);
    expect(needsReadOnce(region)).toBe(false);
    expect(needsReadOnce({ ...idle, in_focus: true })).toBe(false);
    expect(needsReadOnce({ ...idle, readable_lists: 0 })).toBe(false);
  });
});

describe("addTokyoDays", () => {
  it("moves across month and year ends in calendar days", () => {
    expect(addTokyoDays("2026-11-02", 7)).toBe("2026-11-09");
    expect(addTokyoDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addTokyoDays("2026-11-02", 366)).toBe("2027-11-03");
  });
});

describe("the region route client", () => {
  it("reads the status and treats 501 as the backend not applied yet", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: STATUS }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "x", reason: "rpc-missing" }), { status: 501 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await loadRegionStatus())?.regions).toHaveLength(2);
    expect(await loadRegionStatus()).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/twitter-arrivals/regions", expect.objectContaining({ cache: "no-store" }));
  });

  it("posts a change and carries the backend's refusal with its status", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: STATUS }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "region is in focus" }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendRegionAction({ action: "request_read", region: "osaka" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ action: "request_read", region: "osaka" });
    const refused = sendRegionAction({ action: "request_read", region: "akihabara" });
    await expect(refused).rejects.toBeInstanceOf(ArrivalRegionRequestError);
    await expect(refused).rejects.toMatchObject({ status: 400, message: "region is in focus" });
  });
});
