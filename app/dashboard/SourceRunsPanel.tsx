"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";

type ModeSpec = { lane: string; meaning: string };

type JobRow = {
  job: string;
  family: string;
  fetch_lane: string | null;
  artifact_home: string;
  modes: Record<string, ModeSpec>;
  expected_minutes_full: number | null;
  min_interval_hours: number;
};

type RunRow = {
  run_id: number;
  job: string;
  mode: string;
  state: string;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
};

type Verdict = {
  verdict: string;
  job?: string;
  mode?: string;
  reason?: string;
  meaning?: string;
  cooldown_until?: string;
  expected_minutes?: number | null;
};

// report first, then reprocess, then full: the safe taps lead, and the one that
// spends the politeness budget is last.
const MODE_ORDER = ["report", "reprocess", "full"];

const POLL_MS = 10_000;

/**
 * SourceRunsPanel renders whole-source run controls (redesign G3).
 *
 * It is driven entirely by the registry: a mode renders ONLY if the backend
 * registered a use case for it. An absent mode is no button - never a disabled
 * one - and the confirm shows the registry's use case verbatim, so the button's
 * reason to exist is the text the operator reads before tapping.
 */
export function SourceRunsPanel() {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [pending, setPending] = useState<{ job: string; mode: string; spec: ModeSpec; expected: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: j }, { data: r }] = await Promise.all([
      supabase.from("source_run_jobs").select("*").order("job"),
      supabase.from("source_run_requests").select("*").order("requested_at", { ascending: false }).limit(20),
    ]);
    setJobs((j ?? []) as JobRow[]);
    setRuns((r ?? []) as RunRow[]);
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const lastRun = (job: string) => runs.find((r) => r.job === job);

  const submit = async () => {
    if (!pending) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("request_source_run", {
      p_job: pending.job,
      p_mode: pending.mode,
    });
    setBusy(false);
    setPending(null);
    setVerdict(error ? { verdict: "error", reason: error.message } : (data as Verdict));
    void load();
  };

  if (jobs.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">{t("runs.title")}</h3>

      {verdict && (
        <p className="text-xs">
          {verdict.verdict === "queued" && (
            <span className="text-emerald-600 dark:text-emerald-400">
              {t("runs.queued", { job: verdict.job ?? "", mode: verdict.mode ?? "" })}
            </span>
          )}
          {verdict.verdict === "already_running" && (
            <span className="text-amber-600 dark:text-amber-400">{t("runs.alreadyRunning")}</span>
          )}
          {verdict.verdict === "cooldown" && (
            <span className="text-amber-600 dark:text-amber-400">
              {t("runs.cooldown", { until: verdict.cooldown_until ?? "" })} {verdict.reason}
            </span>
          )}
          {(verdict.verdict === "unsupported_mode" || verdict.verdict === "unknown_job" || verdict.verdict === "error") && (
            <span className="text-destructive">{verdict.reason ?? verdict.verdict}</span>
          )}
        </p>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-xs">
          <tbody>
            {jobs.map((j) => {
              const last = lastRun(j.job);
              return (
                <tr key={j.job} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{j.job}</td>
                  <td className="text-muted-foreground px-3 py-2">
                    {last
                      ? t("runs.lastRun", { mode: last.mode, state: last.state })
                      : t("runs.neverRun")}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      {MODE_ORDER.filter((m) => j.modes?.[m]).map((m) => (
                        <Button
                          key={m}
                          variant="outline"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() =>
                            setPending({
                              job: j.job,
                              mode: m,
                              spec: j.modes[m],
                              expected: m === "full" ? j.expected_minutes_full : null,
                            })
                          }
                        >
                          <Play className="size-3" />
                          {t(`runs.mode.${m}` as never)}
                        </Button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {runs.length > 0 && (
        <div className="text-muted-foreground space-y-0.5 text-[11px]">
          {runs.slice(0, 6).map((r) => (
            <div key={r.run_id}>
              {r.job} · {r.mode} · {r.state}
              {r.exit_code != null && r.exit_code !== 0 && ` (exit ${r.exit_code})`}
              {r.started_at && ` · ${new Date(r.started_at).toLocaleString()}`}
            </div>
          ))}
        </div>
      )}

      {/* The confirm renders the registry's use case VERBATIM: the button's
          reason to exist is exactly what the operator reads before tapping. */}
      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending ? t("runs.confirmTitle", { job: pending.job, mode: pending.mode }) : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.spec.meaning}
              {pending?.expected ? ` — ${t("runs.expected", { minutes: pending.expected })}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("runs.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={submit} disabled={busy}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t("runs.start")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
