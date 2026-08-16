import { describe, expect, it } from "vitest";
import { staleSourceCount, newestComputedAt, isStaleSource, type HealthRow } from "./SourceStalenessBadge";

const row = (source: string, run_date: string, fresh: number | null, computed = `${run_date}T08:00:00Z`): HealthRow => ({
  source, run_date, freshness_p50_hours: fresh, computed_at: computed,
});

describe("staleSourceCount", () => {
  it("counts within the newest snapshot only, never across history", () => {
    // Regression: the badge once counted every historical row and reported
    // "96 sources stale" for a 19-source board with 5 stale.
    const rows = [
      row("a", "2026-08-14", 800), row("b", "2026-08-14", 10), row("c", "2026-08-14", 500),
      row("a", "2026-08-13", 700), row("b", "2026-08-13", 9), row("c", "2026-08-13", 480),
      row("a", "2026-08-11", 650), row("b", "2026-08-11", 200), row("c", "2026-08-11", 400),
    ];
    expect(staleSourceCount(rows, 72)).toBe(2);
  });

  it("does not rely on fetch order to find the newest snapshot", () => {
    const rows = [row("a", "2026-08-11", 999), row("a", "2026-08-14", 1)];
    expect(staleSourceCount(rows, 72)).toBe(0);
  });

  it("treats null freshness as not stale and dedupes per source", () => {
    const rows = [row("a", "2026-08-14", null), row("a", "2026-08-14", 999), row("b", "2026-08-14", 99)];
    // first row per source wins; a's null is not stale
    expect(staleSourceCount(rows, 72)).toBe(1);
  });

  it("is zero on an empty fetch", () => {
    expect(staleSourceCount([], 72)).toBe(0);
  });
});

describe("newestComputedAt", () => {
  it("returns the max computed_at across every snapshot", () => {
    const rows = [row("a", "2026-08-13", 1, "2026-08-13T05:00:00Z"), row("a", "2026-08-14", 1, "2026-08-14T08:30:00Z")];
    expect(newestComputedAt(rows)).toBe("2026-08-14T08:30:00Z");
  });
  it("is null on empty", () => {
    expect(newestComputedAt([])).toBeNull();
  });
});

describe("isStaleSource distinguishes dead from incremental", () => {
  const base = { source: "x", run_date: "2026-08-14", computed_at: "2026-08-14T08:00:00Z" };
  it("stale p50 with no run info is stale", () => {
    expect(isStaleSource({ ...base, freshness_p50_hours: 500 }, 72)).toBe(true);
  });
  it("stale p50 but a successful run inside the window is NOT stale (tcgplayer re-stamps only changed rows)", () => {
    expect(isStaleSource({ ...base, freshness_p50_hours: 549, notes: { last_run_hours: 30 } }, 72)).toBe(false);
  });
  it("stale p50 and the last run is also old -> stale", () => {
    expect(isStaleSource({ ...base, freshness_p50_hours: 549, notes: { last_run_hours: 120 } }, 72)).toBe(true);
  });
  it("fresh p50 is never stale regardless of run info", () => {
    expect(isStaleSource({ ...base, freshness_p50_hours: 5, notes: { last_run_hours: 900 } }, 72)).toBe(false);
  });
});
