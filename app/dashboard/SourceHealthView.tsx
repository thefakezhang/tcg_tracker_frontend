"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { SourceRunsPanel } from "./SourceRunsPanel";
import { DuplicateConflictsPanel } from "./DuplicateConflictsPanel";

type HealthRow = {
  run_date: string;
  source: string;
  rows_written: number | null;
  match_rate: number | null;
  unmatched_queue_depth: number | null;
  drift_count: number | null;
  guard_trips: number | null;
  refresh_failures: number | null;
  freshness_p50_hours: number | null;
  table_bytes: number | null;
  notes: Record<string, unknown> | null;
};

type Level = "ok" | "warn" | "bad";

/**
 * Thresholds are deliberately explicit rather than clever: the board's job is to
 * be readable at a glance before acting on a price, so each column states what
 * "bad" means for it.
 */
const level = {
  freshness: (h: number | null): Level =>
    h == null ? "warn" : h < 30 ? "ok" : h < 72 ? "warn" : "bad",
  matchRate: (r: number | null): Level =>
    r == null ? "warn" : r >= 0.9 ? "ok" : r >= 0.7 ? "warn" : "bad",
  // A guard trip means a parse refused to overwrite good data - never "fine".
  guard: (n: number | null): Level => (!n ? "ok" : "bad"),
  failures: (n: number | null): Level => (!n ? "ok" : n <= 2 ? "warn" : "bad"),
  drift: (n: number | null): Level => (!n ? "ok" : n < 10 ? "warn" : "bad"),
};

const levelClass: Record<Level, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-destructive font-medium",
};

function Cell({ value, tone, delta }: { value: string; tone: Level; delta?: string }) {
  return (
    <TableCell className={levelClass[tone]}>
      {value}
      {delta && <span className="text-muted-foreground ml-1 text-[10px]">{delta}</span>}
    </TableCell>
  );
}

/**
 * SourceHealthView renders the nightly per-source rollup (redesign D4).
 *
 * It shows the most recent run_date, with a delta against the day before, so a
 * source that just got worse is visible without remembering yesterday's numbers.
 */
export default function SourceHealthView() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [prev, setPrev] = useState<Map<string, HealthRow>>(new Map());
  const [runDate, setRunDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    // Two most recent days only: the board is "today vs yesterday", not a history.
    const { data, error: qErr } = await supabase
      .from("source_health")
      .select("*")
      .order("run_date", { ascending: false })
      .limit(400);
    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      return;
    }
    const all = (data ?? []) as HealthRow[];
    if (all.length === 0) {
      setRows([]);
      setRunDate(null);
      return;
    }
    const latest = all[0].run_date;
    const priorDate = all.find((r) => r.run_date !== latest)?.run_date ?? null;
    setRunDate(latest);
    setRows(all.filter((r) => r.run_date === latest).sort((a, b) => a.source.localeCompare(b.source)));
    setPrev(new Map(all.filter((r) => r.run_date === priorDate).map((r) => [r.source, r])));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const deltaOf = useMemo(
    () => (source: string, pick: (r: HealthRow) => number | null) => {
      const before = prev.get(source);
      if (!before) return undefined;
      const a = pick(before);
      const b = rows.find((r) => r.source === source);
      if (a == null || !b) return undefined;
      const now = pick(b);
      if (now == null) return undefined;
      const d = now - a;
      if (d === 0) return undefined;
      return d > 0 ? `+${Math.round(d)}` : `${Math.round(d)}`;
    },
    [prev, rows],
  );

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium">
          {runDate ? t("health.asOf", { date: runDate }) : t("health.title")}
        </h2>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {t("health.reload")}
        </Button>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {!loading && rows.length === 0 && !error && (
        <p className="text-muted-foreground text-sm">{t("health.empty")}</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("health.colSource")}</TableHead>
                <TableHead>{t("health.colRows")}</TableHead>
                <TableHead>{t("health.colFreshness")}</TableHead>
                <TableHead>{t("health.colMatchRate")}</TableHead>
                <TableHead>{t("health.colQueue")}</TableHead>
                <TableHead>{t("health.colDrift")}</TableHead>
                <TableHead>{t("health.colGuard")}</TableHead>
                <TableHead>{t("health.colFailures")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.source}>
                  <TableCell className="font-medium">{r.source}</TableCell>
                  <TableCell>
                    {r.rows_written ?? "-"}
                    {deltaOf(r.source, (x) => x.rows_written) && (
                      <span className="text-muted-foreground ml-1 text-[10px]">
                        {deltaOf(r.source, (x) => x.rows_written)}
                      </span>
                    )}
                  </TableCell>
                  <Cell
                    value={r.freshness_p50_hours == null ? "-" : `${Math.round(r.freshness_p50_hours)}h`}
                    tone={level.freshness(r.freshness_p50_hours)}
                  />
                  <Cell
                    value={r.match_rate == null ? "-" : `${Math.round(r.match_rate * 100)}%`}
                    tone={level.matchRate(r.match_rate)}
                  />
                  <TableCell>{r.unmatched_queue_depth ?? 0}</TableCell>
                  <Cell value={String(r.drift_count ?? 0)} tone={level.drift(r.drift_count)} />
                  <Cell value={String(r.guard_trips ?? 0)} tone={level.guard(r.guard_trips)} />
                  <Cell value={String(r.refresh_failures ?? 0)} tone={level.failures(r.refresh_failures)} />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-muted-foreground text-xs">{t("health.legend")}</p>

      <DuplicateConflictsPanel />

      <SourceRunsPanel />
    </div>
  );
}
