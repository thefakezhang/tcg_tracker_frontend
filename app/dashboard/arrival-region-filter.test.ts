import { describe, expect, it } from "vitest";

import type { ArrivalSource } from "./arrival-accounts";
import {
  canonicalRegions,
  pendingReadKey,
  regionFilterOptions,
  statusListsRegions,
  unknownRegions,
} from "./arrival-region-filter";
import type { ArrivalRegion, ArrivalRegionStatus } from "./arrival-regions";

function source(buyer: string, region: string | null, recent: number, posts: number): ArrivalSource {
  return { buyer_handle: buyer, twitter_handle: `${buyer}_shop`, post_count: posts, recent_count: recent, latest_post_at: null, region };
}

function entry(region: string, position: number, overrides: Partial<ArrivalRegion> = {}): ArrivalRegion {
  return {
    region,
    position,
    default_focus: false,
    in_focus: false,
    focus_kind: "off",
    focus_until: null,
    focus_set_by: null,
    focus_set_at: null,
    in_focus_last_run: false,
    lists: 1,
    readable_lists: 1,
    shops: 1,
    list_only_shops: 1,
    last_read_at: null,
    pending_request: null,
    last_fulfilled: null,
    ...overrides,
  };
}

function status(regions: ArrivalRegion[]): ArrivalRegionStatus {
  return { today: "2026-11-11", focus_source: "default", published_at: null, regions };
}

const SOURCES = [
  source("alice", "akihabara", 3, 42),
  source("erin", "akihabara", 4, 10),
  source("bob", "fukuoka", 0, 7),
  source("dave", null, 1, 1),
  source("gina", "okinawa", 2, 2),
];
const STATUS = status([entry("akihabara", 0), entry("nagoya", 8), entry("fukuoka", 13)]);

describe("regionFilterOptions", () => {
  it("lists every region of the status in its order, a region without posts at 0, then the summary's other regions", () => {
    expect(regionFilterOptions(SOURCES, STATUS, []).map(({ region, recent_count, post_count, status: known }) => (
      [region, recent_count, post_count, known?.position ?? null]
    ))).toEqual([
      ["akihabara", 7, 52, 0],
      ["nagoya", 0, 0, 8],
      ["fukuoka", 0, 7, 13],
      // The summary places a shop in a region the status does not list: still offered, without a state.
      ["okinawa", 2, 2, null],
    ]);
  });

  it("falls back to the summary's regions by key without a status, or with one that lists none", () => {
    for (const fallback of [null, status([])]) {
      expect(regionFilterOptions(SOURCES, fallback, []).map((option) => option.region)).toEqual(["akihabara", "fukuoka", "okinawa"]);
      expect(regionFilterOptions(SOURCES, fallback, []).every((option) => option.status === null)).toBe(true);
    }
  });

  it("keeps a selected region nothing else lists, last, so the selection always shows", () => {
    expect(regionFilterOptions(SOURCES, null, ["sendai", "fukuoka"]).map((option) => option.region))
      .toEqual(["akihabara", "fukuoka", "okinawa", "sendai"]);
  });
});

describe("region selection", () => {
  it("is canonical: each key once, sorted", () => {
    expect(canonicalRegions(["fukuoka", "akihabara", "fukuoka"])).toEqual(["akihabara", "fukuoka"]);
    expect(canonicalRegions([])).toEqual([]);
  });

  it("drops only keys a listed status and the summary both do not know", () => {
    expect(unknownRegions(["akihabara", "okinawa", "atlantis"], SOURCES, STATUS)).toEqual(["atlantis"]);
    expect(unknownRegions(["atlantis"], SOURCES, null)).toEqual([]);
    expect(unknownRegions(["atlantis"], SOURCES, status([]))).toEqual([]);
    expect(statusListsRegions(STATUS)).toBe(true);
    expect(statusListsRegions(status([]))).toBe(false);
    expect(statusListsRegions(null)).toBe(false);
  });

  it("keys the polling on the selected regions' pending requests", () => {
    const pending = (id: number) => ({ pending_request: { request_id: id, requested_at: "2026-11-11T03:00:00Z", requested_by: null } });
    const reading = status([entry("akihabara", 0), entry("nagoya", 8, pending(4)), entry("fukuoka", 13, pending(7))]);
    expect(pendingReadKey(reading, ["fukuoka", "nagoya"])).toBe("fukuoka:7,nagoya:4");
    expect(pendingReadKey(reading, ["fukuoka"])).toBe("fukuoka:7");
    // A pending read of a region not selected does not poll.
    expect(pendingReadKey(reading, ["akihabara"])).toBe("");
    expect(pendingReadKey(reading, [])).toBe("");
    expect(pendingReadKey(null, ["fukuoka"])).toBe("");
  });
});
