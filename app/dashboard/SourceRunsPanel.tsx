"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CloudOff,
  LoaderCircle,
  Play,
  Radio,
  Server,
} from "lucide-react";

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
import {
  capabilityState,
  classifySnapshotError,
  durationSeconds,
  isSnapshot,
  MODE_ORDER,
  shortSha,
  type ModeReadiness,
  type ModeSpec,
  type SnapshotIssue,
  type SourceRun,
  type SourceRunHost,
  type SourceRunMode,
  type SourceRunSnapshot,
  type SourceRunTask,
  type Verdict,
} from "./source-run-control";

const POLL_MS = 10_000;
const EMPTY_SNAPSHOT: SourceRunSnapshot = {
  server_time: new Date(0).toISOString(),
  jobs: [],
  runs: [],
  hosts: [],
  inventory: [],
};

type PendingRun = {
  job: string;
  mode: SourceRunMode;
  spec: ModeSpec;
  readiness: ModeReadiness;
  expected: number | null;
  dangerous: boolean;
};

function stateTone(state: string): string {
  switch (state) {
    case "ready":
    case "eligible":
    case "done":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "awaiting_session":
    case "queued_scope_busy":
    case "claimed":
    case "running":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "deferred_unsupported":
      return "border-border bg-muted text-muted-foreground";
    case "failure":
    case "host_failure":
    case "error":
    case "rejected":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function StatusPill({ state, label }: { state: string; label: string }) {
  return (
    <span className={`inline-flex min-h-7 items-center rounded-full border px-2 py-1 text-[11px] font-medium ${stateTone(state)}`}>
      {label}
    </span>
  );
}

function ReadinessExplanation({ readiness }: { readiness: ModeReadiness }) {
  const { t } = useTranslation();
  return (
    <p className="text-muted-foreground text-xs">
      {t(`runs.readiness.${readiness.reason_code}` as never, {
        host: readiness.host_name ?? t("runs.unknownHost"),
        lane: readiness.lane ? t(`runs.lane.${readiness.lane}` as never) : "",
        artifact: readiness.artifact_home ?? "",
      })}
    </p>
  );
}

function LoadIssueBanner({ issue, staleAt, retry }: { issue: SnapshotIssue; staleAt?: string; retry: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3" aria-live="polite">
      <p className="text-sm font-medium">{t(`runs.issue.${issue}.title` as never)}</p>
      <p className="text-muted-foreground mt-1 text-xs">{t(`runs.issue.${issue}.body` as never)}</p>
      {staleAt ? <p className="text-muted-foreground mt-1 text-xs">{t("runs.showingPrior", { time: new Date(staleAt).toLocaleString() })}</p> : null}
      <Button type="button" variant="outline" size="sm" className="mt-3 min-h-11" onClick={retry}>
        {t("runs.retry")}
      </Button>
    </section>
  );
}

function HostCard({ host }: { host: SourceRunHost }) {
  const { t } = useTranslation();
  const lanes = ["http", "browser", "session"] as const;
  return (
    <article className="min-w-0 rounded-lg border p-3" data-testid={`run-host-${host.host_id}`}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Server className="size-4 shrink-0" aria-hidden="true" />
            <h4 className="truncate text-sm font-medium">{host.display_name}</h4>
          </div>
          <p className="text-muted-foreground mt-1 truncate font-mono text-[10px]">{host.host_id}</p>
        </div>
        <StatusPill state={host.status} label={t(`runs.hostStatus.${host.status}` as never)} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" aria-label={t("runs.capabilities")}>
        {lanes.map((lane) => {
          const state = capabilityState(host, lane);
          return (
            <StatusPill
              key={lane}
              state={state}
              label={`${t(`runs.lane.${lane}` as never)}: ${t(`runs.capability.${state}` as never)}`}
            />
          );
        })}
      </div>

      <div className="text-muted-foreground mt-2 grid min-w-0 gap-1 text-[10px] sm:grid-cols-2">
        <p className="min-w-0 break-words">
          {t("runs.hostJobs")}: {host.supported_jobs.length ? host.supported_jobs.join(", ") : t("runs.noneAdvertised")}
        </p>
        <p className="min-w-0 break-words">
          {t("runs.artifactHomes")}: {host.artifact_homes.length ? host.artifact_homes.join(", ") : t("runs.noneAdvertised")}
        </p>
      </div>

      {host.failure_code && (
        <p className="text-destructive mt-2 flex items-start gap-1.5 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {t(`runs.hostFailure.${host.failure_code}` as never)}
        </p>
      )}
      {host.active_job && host.active_state && (
        <p className="mt-2 text-xs">
          {t(`runs.hostActive.${host.active_state}` as never, {
            job: host.active_job,
            mode: host.active_mode ?? "",
          })}
        </p>
      )}

      <div className="text-muted-foreground mt-3 grid grid-cols-3 gap-2 text-[10px]">
        <div className="min-w-0">
          <span className="block">{t("runs.executorSha")}</span>
          <code title={host.executor_sha}>{shortSha(host.executor_sha)}</code>
        </div>
        <div className="min-w-0">
          <span className="block">{t("runs.releaseSha")}</span>
          <code title={host.release_sha}>{shortSha(host.release_sha)}</code>
        </div>
        <div className="min-w-0">
          <span className="block">{t("runs.dataSha")}</span>
          <code title={host.data_sha}>{shortSha(host.data_sha)}</code>
        </div>
      </div>
      <p className="text-muted-foreground mt-2 text-[10px]">
        {t("runs.heartbeatAt", { time: new Date(host.last_heartbeat_at).toLocaleString() })}
      </p>
    </article>
  );
}

function RunEvidence({
  run,
  now,
  cancelling,
  onCancel,
}: {
  run: SourceRun;
  now: Date;
  cancelling: boolean;
  onCancel: (run: SourceRun) => void;
}) {
  const { t } = useTranslation();
  const seconds = durationSeconds(run, now);
  return (
    <article className="min-w-0 rounded-md border p-3" data-testid={`source-run-${run.run_id}`}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{run.job} · {t(`runs.mode.${run.mode}` as never)}</p>
          <p className="text-muted-foreground mt-0.5 text-[11px]">
            {new Date(run.requested_at).toLocaleString()}
            {seconds != null ? ` · ${t("runs.duration", { seconds })}` : ""}
          </p>
        </div>
        <StatusPill state={run.display_state} label={t(`runs.state.${run.display_state}` as never)} />
      </div>

      {(run.display_state === "queued_host_offline" || run.display_state === "queued_scope_busy" || run.display_state === "awaiting_session" || run.display_state === "host_failure") && (
        <div className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs">
          {run.display_state === "queued_host_offline" ? <CloudOff className="mt-0.5 size-3.5 shrink-0" /> : <Clock3 className="mt-0.5 size-3.5 shrink-0" />}
          {run.readiness ? <ReadinessExplanation readiness={run.readiness} /> : t(`runs.explain.${run.display_state}` as never)}
        </div>
      )}
      {(run.display_state === "host_incapable" || run.display_state === "deferred_unsupported") && run.readiness ? (
        <div className="mt-2 flex items-start gap-1.5">
          <AlertTriangle className="text-amber-600 mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <ReadinessExplanation readiness={run.readiness} />
        </div>
      ) : null}
      {run.result_summary && <p className="mt-2 text-xs">{run.result_summary}</p>}
      {run.failure_code && <p className="text-destructive mt-1 text-xs">{t("runs.failureCode", { code: run.failure_code })}</p>}
      <p className="text-muted-foreground mt-2 text-[11px]">
        {t("runs.attemptCount", { count: run.claim_attempt_count })}
        {run.exit_code != null ? ` · ${t("runs.exitCode", { code: run.exit_code })}` : ""}
      </p>
      {run.state === "claimed" && run.claimed_at ? <p className="text-muted-foreground mt-1 text-[11px]">{t("runs.claimedAt", { time: new Date(run.claimed_at).toLocaleString() })}</p> : null}
      {run.state === "running" && run.started_at ? <p className="text-muted-foreground mt-1 text-[11px]">{t("runs.startedAt", { time: new Date(run.started_at).toLocaleString() })}</p> : null}
      {run.state === "error" && run.started_at ? (
        <p className="text-destructive mt-2 flex items-start gap-1.5 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {t("runs.partialExecutionWarning")}
        </p>
      ) : null}

      {run.state === "pending" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 min-h-11 w-full sm:w-auto"
          disabled={cancelling}
          onClick={() => onCancel(run)}
        >
          {cancelling ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {t("runs.cancelQueued")}
        </Button>
      ) : null}

      {(run.executor_sha || run.evidence_ref) && (
        <details className="mt-2 min-w-0 text-[11px]">
          <summary className="flex min-h-11 cursor-pointer items-center py-1 text-muted-foreground">{t("runs.evidence")}</summary>
          <div className="bg-muted/40 min-w-0 space-y-1 rounded p-2">
            {run.claimed_by_host_name && <p>{t("runs.claimedBy", { host: run.claimed_by_host_name })}</p>}
            <p className="break-words font-mono">
              exec {shortSha(run.executor_sha)} · release {shortSha(run.release_sha)} · data {shortSha(run.data_sha)}
            </p>
            {run.evidence_ref && <p className="break-all font-mono">{run.evidence_ref}</p>}
            {run.evidence_sha256 && <p className="break-all font-mono text-[9px]">sha256:{run.evidence_sha256}</p>}
          </div>
        </details>
      )}
    </article>
  );
}

/** Registry-driven whole-source run control with truthful host readiness. */
export function SourceRunsPanel() {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<SourceRunSnapshot>(EMPTY_SNAPSHOT);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadIssue, setLoadIssue] = useState<SnapshotIssue | null>(null);
  const [pending, setPending] = useState<PendingRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancellingRunID, setCancellingRunID] = useState<number | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const load = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("source_run_control_snapshot", { p_run_limit: 30 });
      setLoading(false);
      if (error) {
        setLoadIssue(classifySnapshotError(error));
        return;
      }
      if (!isSnapshot(data)) {
        setLoadIssue("malformed");
        return;
      }
      setSnapshot(data);
      setHasSnapshot(true);
      setLoadIssue(null);
    } catch (error) {
      setLoading(false);
      setLoadIssue(classifySnapshotError(error));
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const latestByJob = useMemo(() => {
    const result = new Map<string, SourceRun>();
    for (const run of snapshot.runs) if (!result.has(run.job)) result.set(run.job, run);
    return result;
  }, [snapshot.runs]);
  const jobsByName = useMemo(
    () => new Map(snapshot.jobs.map((job) => [job.job, job])),
    [snapshot.jobs],
  );

  const submit = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("request_source_run", {
        p_job: pending.job,
        p_mode: pending.mode,
        p_confirm_dangerous: pending.dangerous,
      });
      const response = data as Verdict | null;
      setVerdict(error || !response || typeof response.verdict !== "string"
        ? { verdict: "error", reason: t("runs.requestFailed") }
        : response);
    } catch {
      setVerdict({ verdict: "error", reason: t("runs.requestFailed") });
    } finally {
      setBusy(false);
      setPending(null);
      void load();
    }
  };

  const cancelRun = async (run: SourceRun) => {
    setCancellingRunID(run.run_id);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("cancel_source_run", { p_run_id: run.run_id });
      const response = data as Verdict | null;
      setVerdict(error || !response || typeof response.verdict !== "string"
        ? { verdict: "error", reason: t("runs.cancelFailed") }
        : response);
    } catch {
      setVerdict({ verdict: "error", reason: t("runs.cancelFailed") });
    } finally {
      setCancellingRunID(null);
      void load();
    }
  };

  if (loading) {
    return <div className="flex min-h-24 items-center justify-center" aria-label={t("runs.loading")}><LoaderCircle className="size-5 animate-spin" /></div>;
  }

  if (loadIssue && !hasSnapshot) {
    return <LoadIssueBanner issue={loadIssue} retry={() => void load()} />;
  }

  const now = new Date(snapshot.server_time);
  return (
    <section className="min-w-0 space-y-4" aria-labelledby="source-runs-heading">
      <div>
        <div className="flex items-center gap-2">
          <Radio className="size-4" aria-hidden="true" />
          <h3 id="source-runs-heading" className="text-sm font-medium">{t("runs.title")}</h3>
        </div>
        <p className="text-muted-foreground mt-1 text-xs">{t("runs.subtitle")}</p>
      </div>

      {loadIssue ? <LoadIssueBanner issue={loadIssue} staleAt={snapshot.server_time} retry={() => void load()} /> : null}

      <div className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide">{t("runs.hostsTitle")}</h4>
        {snapshot.hosts.length === 0 ? (
          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            {t("runs.noHosts")}
          </div>
        ) : (
          <div className="grid min-w-0 gap-2 lg:grid-cols-2">
            {snapshot.hosts.map((host) => <HostCard key={host.host_id} host={host} />)}
          </div>
        )}
      </div>

      {verdict && (
        <div className="rounded-md border p-3 text-xs" aria-live="polite">
          {verdict.verdict === "queued" && <span className="text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="mr-1 inline size-3.5" />{t("runs.queued", { job: verdict.job ?? "", mode: verdict.mode ?? "" })}</span>}
          {verdict.verdict === "already_running" && <span>{t("runs.alreadyRunning")}</span>}
          {verdict.verdict === "cooldown" && <span>{t("runs.cooldown", { until: verdict.cooldown_until ?? "" })} {verdict.reason}</span>}
          {verdict.verdict === "cancelled" && <span>{t("runs.cancelled", { job: verdict.job ?? "", mode: verdict.mode ?? "" })}</span>}
          {verdict.verdict === "not_pending" && <span>{t("runs.notPending")}</span>}
          {verdict.verdict === "unknown_run" && <span>{t("runs.unknownRun")}</span>}
          {verdict.verdict === "remote_unsupported" && <span>{t("runs.remoteUnsupported", { job: verdict.job ?? "", mode: verdict.mode ?? "" })}</span>}
          {(verdict.verdict === "unsupported_mode" || verdict.verdict === "unknown_job" || verdict.verdict === "error") && <span className="text-destructive">{verdict.reason ?? verdict.verdict}</span>}
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide">{t("runs.schedulerTitle")}</h4>
        <p className="text-muted-foreground text-xs">{t("runs.schedulerSubtitle")}</p>
        <div className="grid min-w-0 gap-2 xl:grid-cols-2">
          {snapshot.inventory.map((task: SourceRunTask) => {
            const sourceJob = jobsByName.get(task.job);
            const mode = task.manual_mode;
            const spec = mode ? sourceJob?.modes[mode] : undefined;
            const manualReadiness = mode ? sourceJob?.readiness[mode] : undefined;
            const canRequest = (task.control_state === "manual_available" || task.control_state === "confirmation_required")
              && !!mode && !!spec && !!manualReadiness
              && manualReadiness.state !== "deferred_unsupported";
            const scheduleState = task.schedule_readiness.state;
            return (
              <article key={task.task_name} className="min-w-0 rounded-lg border p-3" data-testid={`scheduler-task-${task.task_name}`}>
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h5 className="truncate text-sm font-medium">{task.task_name}</h5>
                    <p className="text-muted-foreground mt-0.5 break-words text-[11px]">
                      {task.cadence} · {task.job} · {task.lane}
                    </p>
                  </div>
                  <StatusPill state={scheduleState} label={t(`runs.scheduleState.${scheduleState}` as never)} />
                </div>
                <p className="text-muted-foreground mt-2 text-xs">{task.policy_reason}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <StatusPill state={task.control_state} label={t(`runs.controlState.${task.control_state}` as never)} />
                  <StatusPill state={task.evidence_state} label={t(`runs.evidenceState.${task.evidence_state}` as never)} />
                </div>
                {task.active_run ? (
                  <p className="mt-2 text-xs">{t("runs.taskActive", { mode: task.active_run.mode, state: task.active_run.state })}</p>
                ) : null}
                {task.latest_run ? (
                  <p className="text-muted-foreground mt-1 text-[11px]">
                    {t("runs.taskLatest", {
                      state: task.latest_run.state,
                      time: task.latest_run.finished_at ? new Date(task.latest_run.finished_at).toLocaleString() : "",
                    })}
                  </p>
                ) : null}
                {canRequest ? (
                  <Button
                    type="button"
                    variant={task.control_state === "confirmation_required" ? "destructive" : "outline"}
                    size="sm"
                    className="mt-3 min-h-11 w-full sm:w-auto"
                    onClick={() => setPending({
                      job: task.job,
                      mode: mode!,
                      spec: spec!,
                      readiness: manualReadiness!,
                      expected: mode === "full" ? sourceJob?.expected_minutes_full ?? null : null,
                      dangerous: task.control_state === "confirmation_required",
                    })}
                  >
                    <Play className="size-3.5" aria-hidden="true" />
                    {task.control_state === "confirmation_required" ? t("runs.reviewDangerous") : t("runs.runNow")}
                  </Button>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide">{t("runs.jobsTitle")}</h4>
        <div className="grid min-w-0 gap-2 xl:grid-cols-2">
          {snapshot.jobs.map((job) => {
            const last = latestByJob.get(job.job);
            return (
              <article key={job.job} className="min-w-0 rounded-lg border p-3">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h5 className="truncate text-sm font-medium">{job.job}</h5>
                    <p className="text-muted-foreground mt-0.5 text-[11px]">{job.family} · {job.artifact_home}</p>
                  </div>
                  {last ? <StatusPill state={last.display_state} label={t(`runs.state.${last.display_state}` as never)} /> : null}
                </div>
                {last && (last.display_state === "queued_host_offline" || last.display_state === "queued_scope_busy" || last.display_state === "awaiting_session" || last.display_state === "host_failure") && (
                  <div className="mt-2">{last.readiness ? <ReadinessExplanation readiness={last.readiness} /> : <p className="text-muted-foreground text-xs">{t(`runs.explain.${last.display_state}` as never)}</p>}</div>
                )}
                {(last?.display_state === "host_incapable" || last?.display_state === "deferred_unsupported") && last.readiness ? <div className="mt-2"><ReadinessExplanation readiness={last.readiness} /></div> : null}
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {MODE_ORDER.filter((mode) => job.modes?.[mode]).map((mode) => (
                    <Button
                      key={mode}
                      variant="outline"
                      size="sm"
                      className="min-h-11 w-full justify-center px-3"
                      disabled={job.readiness[mode]?.state === "deferred_unsupported"}
                      aria-describedby={job.readiness[mode]?.state === "deferred_unsupported" ? `run-${job.job}-${mode}-readiness` : undefined}
                      onClick={() => setPending({
                        job: job.job,
                        mode,
                        spec: job.modes[mode]!,
                        readiness: job.readiness[mode]!,
                        expected: mode === "full" ? job.expected_minutes_full : null,
                        dangerous: job.modes[mode]?.manual_policy === "dangerous_confirmation",
                      })}
                    >
                      <Play className="size-3.5" aria-hidden="true" />
                      {t(`runs.mode.${mode}` as never)}
                    </Button>
                  ))}
                </div>
                <div className="mt-2 space-y-1">
                  {MODE_ORDER.filter((mode) => job.readiness[mode]?.state === "deferred_unsupported").map((mode) => (
                    <div id={`run-${job.job}-${mode}-readiness`} key={mode}>
                      <ReadinessExplanation readiness={job.readiness[mode]!} />
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide">{t("runs.recentTitle")}</h4>
        {snapshot.runs.length === 0 ? <p className="text-muted-foreground text-xs">{t("runs.neverRun")}</p> : (
          <div className="grid min-w-0 gap-2 lg:grid-cols-2">
            {snapshot.runs.slice(0, 10).map((run) => (
              <RunEvidence
                key={run.run_id}
                run={run}
                now={now}
                cancelling={cancellingRunID === run.run_id}
                onCancel={(selected) => void cancelRun(selected)}
              />
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent className="max-h-[90dvh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>{pending ? t("runs.confirmTitle", { job: pending.job, mode: pending.mode }) : ""}</AlertDialogTitle>
            <AlertDialogDescription render={<div />}>
              <div className="space-y-2">
                <p>{pending?.spec.meaning}</p>
                <p>{t("runs.confirmLane", { lane: pending ? t(`runs.lane.${pending.spec.lane}` as never) : "" })}</p>
                {pending ? (
                  <div className="space-y-1 rounded-md border p-2">
                    <StatusPill state={pending.readiness.state} label={t(`runs.state.${pending.readiness.state}` as never)} />
                    <ReadinessExplanation readiness={pending.readiness} />
                    <p className="text-amber-700 dark:text-amber-300">
                      {t(pending.readiness.state === "eligible"
                        ? "runs.confirmQueuesSoon"
                        : pending.readiness.state === "queued_scope_busy"
                          ? "runs.confirmScopeBusy"
                          : "runs.confirmMayRunLater")}
                    </p>
                  </div>
                ) : null}
                {pending?.expected ? <p>{t("runs.expected", { minutes: pending.expected })}</p> : null}
                {pending?.dangerous ? <p className="text-destructive font-medium">{t("runs.dangerousWarning")}</p> : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">{t("runs.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={submit} disabled={busy || pending?.readiness.state === "deferred_unsupported"}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {t("runs.start")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
