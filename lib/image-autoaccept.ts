export type AutoAcceptKind = "singles" | "sealed";

export interface AutoAcceptControl {
  global_enabled: boolean;
  daily_cap: number;
  reason: string;
  updated_at: string;
}

export interface AutoAcceptSourceStatus {
  source: string;
  kind: AutoAcceptKind;
  fingerprint: string;
  sampled: number;
  reviewed: number;
  successes: number;
  failures: number;
  excluded: number;
  precision: number | null;
  wilson_lower_95: number | null;
  reviews_remaining: number;
  calibration_ready: boolean;
  canary_passed: boolean;
  eligible_revisions: number;
  total_revisions: number;
  configured: boolean;
  enabled: boolean;
  identity_threshold: number | null;
  per_run_cap: number | null;
  daily_cap: number | null;
}

export interface AutoAcceptRun {
  run_uid: string;
  source_author_handle: string | null;
  candidate_kind: AutoAcceptKind | null;
  execution_mode: "scheduled" | "operator_canary";
  reason: string | null;
  requested_cap: number;
  started_at: string;
  completed_at: string | null;
  status: "running" | "completed" | "failed";
  summary: Record<string, unknown>;
}

export interface AutoAcceptStatus {
  control: AutoAcceptControl;
  sources: AutoAcceptSourceStatus[];
  recent_runs: AutoAcceptRun[];
}

const numberOr = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export function parseAutoAcceptStatus(raw: unknown): AutoAcceptStatus {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const controlRaw = value.control && typeof value.control === "object"
    ? value.control as Record<string, unknown>
    : {};
  const sourcesRaw = Array.isArray(value.sources) ? value.sources : [];
  const runsRaw = Array.isArray(value.recent_runs) ? value.recent_runs : [];
  return {
    control: {
      global_enabled: controlRaw.global_enabled === true,
      daily_cap: numberOr(controlRaw.daily_cap, 250),
      reason: typeof controlRaw.reason === "string" ? controlRaw.reason : "",
      updated_at: typeof controlRaw.updated_at === "string" ? controlRaw.updated_at : "",
    },
    sources: sourcesRaw.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const row = entry as Record<string, unknown>;
      if (
        typeof row.source !== "string"
        || (row.kind !== "singles" && row.kind !== "sealed")
        || typeof row.fingerprint !== "string"
      ) return [];
      return [{
        source: row.source,
        kind: row.kind,
        fingerprint: row.fingerprint,
        sampled: numberOr(row.sampled),
        reviewed: numberOr(row.reviewed),
        successes: numberOr(row.successes),
        failures: numberOr(row.failures),
        excluded: numberOr(row.excluded),
        precision: typeof row.precision === "number" ? row.precision : null,
        wilson_lower_95: typeof row.wilson_lower_95 === "number" ? row.wilson_lower_95 : null,
        reviews_remaining: numberOr(row.reviews_remaining, 381),
        calibration_ready: row.calibration_ready === true,
        canary_passed: row.canary_passed === true,
        eligible_revisions: numberOr(row.eligible_revisions),
        total_revisions: numberOr(row.total_revisions),
        configured: row.configured === true,
        enabled: row.enabled === true,
        identity_threshold: typeof row.identity_threshold === "number" ? row.identity_threshold : null,
        per_run_cap: typeof row.per_run_cap === "number" ? row.per_run_cap : null,
        daily_cap: typeof row.daily_cap === "number" ? row.daily_cap : null,
      } satisfies AutoAcceptSourceStatus];
    }),
    recent_runs: runsRaw.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const row = entry as Record<string, unknown>;
      if (typeof row.run_uid !== "string" || typeof row.started_at !== "string") return [];
      return [{
        run_uid: row.run_uid,
        source_author_handle: typeof row.source_author_handle === "string" ? row.source_author_handle : null,
        candidate_kind: row.candidate_kind === "singles" || row.candidate_kind === "sealed"
          ? row.candidate_kind
          : null,
        execution_mode: row.execution_mode === "operator_canary" ? "operator_canary" : "scheduled",
        reason: typeof row.reason === "string" ? row.reason : null,
        requested_cap: numberOr(row.requested_cap),
        started_at: row.started_at,
        completed_at: typeof row.completed_at === "string" ? row.completed_at : null,
        status: row.status === "running" || row.status === "failed" ? row.status : "completed",
        summary: row.summary && typeof row.summary === "object"
          ? row.summary as Record<string, unknown>
          : {},
      } satisfies AutoAcceptRun];
    }),
  };
}

export function calibrationProgress(source: AutoAcceptSourceStatus): number {
  return Math.min(100, Math.round((source.reviewed / 381) * 100));
}

export function unreviewedSamples(source: AutoAcceptSourceStatus): number {
  return Math.max(0, source.sampled - source.reviewed - source.excluded);
}

export function percent(value: number | null): string {
  return value == null ? "-" : `${(value * 100).toFixed(2)}%`;
}

export function sourceStatusKey(source: AutoAcceptSourceStatus): string {
  return `${source.source}:${source.kind}:${source.fingerprint}`;
}
