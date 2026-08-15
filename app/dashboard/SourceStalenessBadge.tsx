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

interface HealthRow {
  freshness_p50_hours: number | null;
  computed_at: string;
}

export default function SourceStalenessBadge() {
  const { t } = useTranslation();
  const { setActiveTripId } = useTrips();
  const [staleCount, setStaleCount] = useState(0);
  const [snapshotAgeHours, setSnapshotAgeHours] = useState<number | null>(null);

  const check = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("source_health")
      .select("freshness_p50_hours, computed_at");
    if (error || !data) return; // no false signal either way; the board stays authoritative
    const rows = data as HealthRow[];
    setStaleCount(rows.filter((r) => r.freshness_p50_hours != null && r.freshness_p50_hours >= STALE_BAD_HOURS).length);
    const newest = rows.reduce<string | null>(
      (acc, r) => (acc == null || r.computed_at > acc ? r.computed_at : acc),
      null,
    );
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
      <span className="tabular-nums">{staleCount > 0 ? staleCount : `${Math.floor(snapshotAgeHours ?? 0)}h`}</span>
      <span className="hidden md:inline">{label}</span>
    </Button>
  );
}
