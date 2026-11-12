import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ArrivalRegionRequestError,
  addTokyoDays,
  focusRegions,
  isReadAction,
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

  it("reads hourly in focus; a pending request is reading while the read job has it or in shop hours, else queued", () => {
    const run = (verdict: string) => ({ verdict, job: "twitter-arrivals-read", mode: "remote", sqlstate: null });
    const inHours = at("2026-11-02T05:00:00Z"); // 14:00 JST
    const outside = at("2026-11-02T13:00:30Z"); // 22:00 JST, 30 seconds after a request
    expect(regionReadState({ ...region, in_focus: true }, inHours, run("remote_unsupported"))).toBe("hourly");
    // The read job has it: reading, in shop hours or not, from the first moment.
    for (const verdict of ["queued", "already_running"]) {
      expect(regionReadState(region, outside, run(verdict)), verdict).toBe("reading");
      expect(regionReadState(region, inHours, run(verdict)), verdict).toBe("reading");
    }
    // No read job (or no answer yet, as before migration 000642): the hourly run
    // reads it in shop hours, and outside them it waits for the next one, at once.
    for (const readRun of [null, undefined, run("remote_unsupported"), run("manual_unsupported"), run("unknown_job"), run("error")]) {
      expect(regionReadState(region, inHours, readRun), readRun?.verdict ?? String(readRun)).toBe("reading");
      expect(regionReadState(region, outside, readRun), readRun?.verdict ?? String(readRun)).toBe("queued");
    }
    expect(regionReadState(idle, inHours)).toBe("idle");
    expect(regionReadState({ ...idle, readable_lists: 0 }, inHours)).toBe("nolist");
  });

  it("reads the ledger's answer to a read-once request, and none from an older backend or a shape it does not know", () => {
    const body = { today: "2026-11-02", focus_source: "default", published_at: null, regions: [ROW] };
    expect(parseRegionStatus(body).read_run).toBeNull();
    expect(parseRegionStatus({ ...body, read_run: { verdict: "queued", job: "twitter-arrivals-read", mode: "remote", run_id: 12 } }).read_run)
      .toEqual({ verdict: "queued", job: "twitter-arrivals-read", mode: "remote", sqlstate: null });
    expect(parseRegionStatus({ ...body, read_run: { verdict: "error", sqlstate: "P0001" } }).read_run)
      .toEqual({ verdict: "error", job: null, mode: null, sqlstate: "P0001" });
    for (const odd of ["queued", [], { verdict: 7 }, { verdict: "" }, {}]) {
      expect(parseRegionStatus({ ...body, read_run: odd }).read_run).toBeNull();
    }
    // Migration 000643's answers, which recorded nothing, read like any other.
    for (const verdict of ["not_pending", "recently_fulfilled"]) {
      expect(parseRegionStatus({ ...body, read_run: { verdict, job: "twitter-arrivals-read", request_id: 61 } }).read_run)
        .toEqual({ verdict, job: "twitter-arrivals-read", mode: null, sqlstate: null });
    }
  });

  it("knows which actions carry the ledger's answer for a region's read", () => {
    expect(isReadAction({ action: "request_read", region: "osaka" })).toBe(true);
    expect(isReadAction({ action: "resume_read", region: "osaka", request_id: 5 })).toBe(true);
    expect(isReadAction({ action: "clear_focus", region: "osaka" })).toBe(false);
    expect(isReadAction({ action: "reset_focus" })).toBe(false);
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

  it("posts a resume with its request id, and a missing resume_read is a 501 refusal", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: STATUS }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "x", reason: "rpc-missing" }), { status: 501 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendRegionAction({ action: "resume_read", region: "osaka", request_id: 5 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "resume_read", region: "osaka", request_id: 5 });
    const missing = sendRegionAction({ action: "resume_read", region: "osaka", request_id: 5 });
    await expect(missing).rejects.toMatchObject({ status: 501 });
  });
});
