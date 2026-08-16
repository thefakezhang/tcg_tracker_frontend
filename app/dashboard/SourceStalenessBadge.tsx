"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useTrips } from "./TripContext";
import { Button } from "@/components/ui/button";

// A month of source staleness once accumulated with no signal outside the
// Source health board (two clicks deep, itself a snapshot). This badge is the
// push half: it surfaces in the global header the moment any source crosses
// the SAME "bad" threshold the board uses, and is ABSENT when all is well -
// per the redesign rule, a control with no use case is absent, not disabled.
//
// It reads the same `source_health` snapshot as SourceHealthView (a ~20-row
// table, bounded by the source count) and re-checks on a slow interval; a
// fetch failure renders nothing rather than a false all-clear badge of its
// own - the board remains the authoritative surface.

// Mirror of SourceHealthView's freshness level: >= 72h is "bad".
const STALE_BAD_HOURS = 72;
// Mirror of the board's own snapshot-age warning threshold.
const SNAPSHOT_STALE_HOURS = 30;
const SOURCE_HEALTH_SENTINEL = -12;
const RECHECK_MS = 10 * 60 * 1000;

export interface HealthRow {
  source: string;
  run_date: string;
  freshness_p50_hours: number | null;
  computed_at: string;
  notes?: Record<string, unknown> | null;
}

// A source is "stale" for the badge when its p50 is past the bad threshold
// AND it has not RUN successfully within that window either - a source that
// ran recently but only re-stamps changed rows (tcgplayer) is incremental,
// not dead, and must not fire the header alarm.
export function isStaleSource(r: HealthRow, badHours: number): boolean {
  if (r.freshness_p50_hours == null || r.freshness_p50_hours < badHours) return false;
  const run = r.notes?.last_run_hours;
  if (typeof run === "number" && Number.isFinite(run) && run < badHours) return false;
  return true;
}

// Pure scoping: the table keeps one row per source PER SNAPSHOT (the board is
// "today vs yesterday"), so the badge must count within the newest run_date
// only, one row per source - counting raw rows multiplies the stale count by
// however much history the fetch returned. Exported for the unit test.
export function staleSourceCount(rows: HealthRow[], badHours: number): number {
  if (!rows.length) return 0;
  const newestRun = rows.reduce((acc, r) => (r.run_date > acc ? r.run_date : acc), rows[0].run_date);
  const latest = new Map<string, HealthRow>();
  for (const r of rows) if (r.run_date === newestRun && !latest.has(r.source)) latest.set(r.source, r);
  return [...latest.values()].filter((r) => isStaleSource(r, badHours)).length;
}

export function newestComputedAt(rows: HealthRow[]): string | null {
  return rows.reduce<string | null>((acc, r) => (acc == null || r.computed_at > acc ? r.computed_at : acc), null);
}

export default function SourceStalenessBadge() {
  const { t } = useTranslation();
  const { setActiveTripId } = useTrips();
  const [staleCount, setStaleCount] = useState(0);
  const [snapshotAgeHours, setSnapshotAgeHours] = useState<number | null>(null);

  const check = useCallback(async () => {
    const supabase = createClient();
    // The table keeps one row per source PER SNAPSHOT (the board shows today
    // vs yesterday), so scope to the newest run_date and one row per source -
    // counting raw rows multiplies the stale count by the snapshot history.
    const { data, error } = await supabase
      .from("source_health")
      .select("source, run_date, freshness_p50_hours, computed_at, notes")
      .order("run_date", { ascending: false })
      .limit(400);
    if (error || !data?.length) return; // no false signal either way; the board stays authoritative
    const rows = data as HealthRow[];
    setStaleCount(staleSourceCount(rows, STALE_BAD_HOURS));
    const newest = newestComputedAt(rows);
    setSnapshotAgeHours(newest == null ? null : (Date.now() - new Date(newest).getTime()) / 3600000);
  }, []);

  useEffect(() => {
    void check();
    const id = setInterval(() => void check(), RECHECK_MS);
    return () => clearInterval(id);
  }, [check]);

  const snapshotStale = snapshotAgeHours != null && snapshotAgeHours >= SNAPSHOT_STALE_HOURS;
  if (staleCount === 0 && !snapshotStale) return null;

  const label = staleCount > 0
    ? t("health.staleBadge", { n: staleCount })
    : t("health.staleBadgeSnapshot", { hours: Math.floor(snapshotAgeHours ?? 0) });

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setActiveTripId(SOURCE_HEALTH_SENTINEL)}
      className={`shrink-0 gap-1 px-2 ${staleCount > 0 ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}
      title={label}
    >
      <AlertTriangle className="size-4" />
      {/* Compact count where the full label doesn't fit; never both. */}
      <span className="tabular-nums md:hidden">{staleCount > 0 ? staleCount : `${Math.floor(snapshotAgeHours ?? 0)}h`}</span>
      <span className="hidden md:inline">{label}</span>
    </Button>
  );
}
