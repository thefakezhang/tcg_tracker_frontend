export type SourceRunMode = "full" | "reprocess" | "report";
export type ArtifactHome = "data-repo" | "state-dir" | "none";
export type ReadinessState =
  | "eligible"
  | "deferred_unsupported"
  | "queued_scope_busy"
  | "awaiting_session"
  | "host_failure"
  | "host_incapable"
  | "queued_host_offline";
export type ReadinessReason =
  | "ready"
  | "remote_not_enabled"
  | "scope_busy"
  | "awaiting_session"
  | "host_failure"
  | "host_offline"
  | "host_disabled"
  | "job_unsupported"
  | "lane_unsupported"
  | "artifact_unavailable"
  | "capability_unavailable"
  | "unsupported_mode";
export type SnapshotIssue = "restricted" | "network" | "malformed" | "server";

export type ModeReadiness = {
  state: ReadinessState;
  reason_code: ReadinessReason;
  host_name: string | null;
  lane: "http" | "browser" | "session" | null;
  artifact_home: ArtifactHome | null;
};

export type ModeSpec = {
  lane: "http" | "browser" | "session";
  meaning: string;
  manual_policy?: "safe" | "session" | "scheduled_only" | "dangerous_confirmation" | "unsupported";
};

export type SourceRunJob = {
  job: string;
  family: string;
  fetch_lane: string | null;
  artifact_home: ArtifactHome;
  modes: Partial<Record<SourceRunMode, ModeSpec>>;
  readiness: Partial<Record<SourceRunMode, ModeReadiness>>;
  expected_minutes_full: number | null;
  min_interval_hours: number;
};

export type SourceRun = {
  run_id: number;
  job: string;
  mode: SourceRunMode;
  state: "pending" | "claimed" | "running" | "done" | "error" | "rejected";
  display_state:
    | "deferred_unsupported"
    | "queued_host_offline"
    | "queued_scope_busy"
    | "awaiting_session"
    | "host_failure"
    | "host_incapable"
    | "eligible"
    | "claimed"
    | "running"
    | "done"
    | "error"
    | "rejected"
    | "cancelled";
  requested_at: string;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  claim_attempt_count: number;
  claimed_by_host_id: string | null;
  claimed_by_host_name: string | null;
  executor_sha: string | null;
  release_sha: string | null;
  data_sha: string | null;
  evidence_ref: string | null;
  evidence_sha256: string | null;
  result_summary: string | null;
  failure_code: string | null;
  readiness: ModeReadiness | null;
};

export type SourceRunHost = {
  host_id: string;
  display_name: string;
  enabled: boolean;
  status: "revoked" | "offline" | "failure" | "awaiting_session" | "ready";
  lanes: Array<"http" | "browser" | "session">;
  supported_jobs: string[];
  capability_job_modes: string[];
  scheduled_job_modes: string[];
  manual_job_modes: string[];
  artifact_homes: ArtifactHome[];
  session_ready: boolean;
  failure_code: "release_mismatch" | "host_reported_unhealthy" | null;
  executor_sha: string;
  release_sha: string;
  data_sha: string;
  last_heartbeat_at: string;
  heartbeat_expires_at: string;
  active_run_id: number | null;
  active_job: string | null;
  active_mode: SourceRunMode | null;
  active_state: "claimed" | "running" | null;
};

export type InventoryReadiness = {
  state: string;
  reason_code: string;
  host_name?: string | null;
  lane?: "http" | "browser" | "session" | null;
  artifact_home?: ArtifactHome | null;
};

export type InventoryRunSummary = {
  run_id: number;
  mode: SourceRunMode;
  state: string;
  requested_at: string;
  claimed_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  exit_code?: number | null;
  claimed_by_host_name?: string | null;
  evidence_ref?: string | null;
  evidence_sha256?: string | null;
  result_summary?: string | null;
  failure_code?: string | null;
};

export type SourceRunTask = {
  task_name: string;
  job: string;
  cadence: string;
  lane: "http" | "browser" | "session" | "maintenance";
  session_required: boolean;
  artifact_home: ArtifactHome;
  schedule_policy: "scheduled" | "maintenance" | "retired" | "staged_activation";
  manual_policy: "safe" | "session" | "scheduled_only" | "dangerous_confirmation" | "unsupported";
  manual_mode: SourceRunMode | null;
  policy_reason: string;
  execution_path: "shared_shim" | "legacy_direct";
  target_state: "documented_target" | "retired";
  schedule_readiness: InventoryReadiness;
  manual_readiness: InventoryReadiness;
  control_state: "manual_available" | "confirmation_required" | "scheduled_only" | "unsupported" | "retired";
  active_run: InventoryRunSummary | null;
  latest_run: InventoryRunSummary | null;
  evidence_state: "managed" | "no_managed_run" | "unobserved_legacy";
};

export type SourceRunSnapshot = {
  server_time: string;
  jobs: SourceRunJob[];
  runs: SourceRun[];
  hosts: SourceRunHost[];
  inventory: SourceRunTask[];
};

export type Verdict = {
  verdict: string;
  job?: string;
  mode?: string;
  reason?: string;
  meaning?: string;
  cooldown_until?: string;
  expected_minutes?: number | null;
};

export const MODE_ORDER: SourceRunMode[] = ["report", "reprocess", "full"];

export function isSnapshot(value: unknown): value is SourceRunSnapshot {
  if (!isRecord(value) || !isDateString(value.server_time)) return false;
  if (!Array.isArray(value.jobs) || !value.jobs.every(isJob)) return false;
  if (!Array.isArray(value.runs) || !value.runs.every(isRun)) return false;
  if (!Array.isArray(value.hosts) || !value.hosts.every(isHost)) return false;
  if (!Array.isArray(value.inventory) || !value.inventory.every(isTask)) return false;
  const visibleJobs = new Set(value.jobs.map((job) => (job as SourceRunJob).job));
  const inventoryJobs = new Set(value.inventory.map((task) => (task as SourceRunTask).job));
  return value.runs.every((run) => visibleJobs.has((run as SourceRun).job))
    && value.hosts.every((host) => {
      const activeJob = (host as SourceRunHost).active_job;
      return activeJob === null || visibleJobs.has(activeJob) || inventoryJobs.has(activeJob);
    });
}

export function classifySnapshotError(error: unknown): Exclude<SnapshotIssue, "malformed"> {
  if (isRecord(error)) {
    const code = typeof error.code === "string" ? error.code : "";
    const status = typeof error.status === "number" ? error.status : 0;
    if (code === "42501" || code === "PGRST301" || status === 401 || status === 403) return "restricted";
    const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
    if (error.name === "TypeError" || message.includes("fetch") || message.includes("network")) return "network";
  }
  return "server";
}

export function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 8) : "-";
}

export function durationSeconds(run: SourceRun, now: Date): number | null {
  const start = run.started_at ?? run.claimed_at;
  if (!start) return null;
  const end = run.finished_at ? new Date(run.finished_at) : now;
  const seconds = Math.floor((end.getTime() - new Date(start).getTime()) / 1000);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : null;
}

export function capabilityState(
  host: SourceRunHost,
  lane: "http" | "browser" | "session",
): "ready" | "awaiting_session" | "offline" | "failure" | "revoked" | "unsupported" {
  if (!host.enabled) return "revoked";
  if (host.status === "offline") return "offline";
  if (host.status === "failure") return "failure";
  if (!host.lanes.includes(lane)) return "unsupported";
  if (lane === "session" && !host.session_ready) return "awaiting_session";
  return "ready";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableDate(value: unknown): value is string | null {
  return value === null || isDateString(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isMode(value: unknown): value is SourceRunMode {
  return value === "full" || value === "reprocess" || value === "report";
}

function isLane(value: unknown): value is "http" | "browser" | "session" {
  return value === "http" || value === "browser" || value === "session";
}

function isArtifactHome(value: unknown): value is ArtifactHome {
  return value === "data-repo" || value === "state-dir" || value === "none";
}

function isReadiness(value: unknown): value is ModeReadiness {
  if (!isRecord(value)) return false;
  const allowedKeys = new Set(["state", "reason_code", "host_name", "lane", "artifact_home"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
  const states: ReadinessState[] = ["eligible", "deferred_unsupported", "queued_scope_busy", "awaiting_session", "host_failure", "host_incapable", "queued_host_offline"];
  const reasons: ReadinessReason[] = [
    "ready", "remote_not_enabled", "scope_busy", "awaiting_session", "host_failure", "host_offline", "host_disabled",
    "job_unsupported", "lane_unsupported", "artifact_unavailable",
    "capability_unavailable", "unsupported_mode",
  ];
  return states.includes(value.state as ReadinessState)
    && reasons.includes(value.reason_code as ReadinessReason)
    && isNullableString(value.host_name)
    && (value.lane === null || isLane(value.lane))
    && (value.artifact_home === null || isArtifactHome(value.artifact_home));
}

function isJob(value: unknown): value is SourceRunJob {
  if (!isRecord(value) || typeof value.job !== "string" || typeof value.family !== "string") return false;
  if (!(value.fetch_lane === null || typeof value.fetch_lane === "string") || !isArtifactHome(value.artifact_home)) return false;
  if (!isRecord(value.modes) || !isRecord(value.readiness)) return false;
  const readiness = value.readiness;
  if (!(value.expected_minutes_full === null || typeof value.expected_minutes_full === "number")
      || typeof value.min_interval_hours !== "number") return false;
  return Object.entries(value.modes).every(([mode, spec]) => isMode(mode)
    && isRecord(spec) && isLane(spec.lane) && typeof spec.meaning === "string"
    && isReadiness(readiness[mode]));
}

function isRun(value: unknown): value is SourceRun {
  if (!isRecord(value) || typeof value.run_id !== "number" || typeof value.job !== "string" || !isMode(value.mode)) return false;
  const states = ["pending", "claimed", "running", "done", "error", "rejected"];
  const displayStates = [
    "deferred_unsupported", "queued_host_offline", "queued_scope_busy", "awaiting_session", "host_failure", "host_incapable",
    "eligible", "claimed", "running", "done", "error", "rejected", "cancelled",
  ];
  return states.includes(value.state as string) && displayStates.includes(value.display_state as string)
    && isDateString(value.requested_at) && isNullableDate(value.claimed_at)
    && isNullableDate(value.started_at) && isNullableDate(value.finished_at)
    && (value.exit_code === null || typeof value.exit_code === "number")
    && typeof value.claim_attempt_count === "number"
    && isNullableString(value.claimed_by_host_id) && isNullableString(value.claimed_by_host_name)
    && isNullableString(value.executor_sha) && isNullableString(value.release_sha)
    && isNullableString(value.data_sha) && isNullableString(value.evidence_ref)
    && isNullableString(value.evidence_sha256) && isNullableString(value.result_summary)
    && isNullableString(value.failure_code)
    && (value.readiness === null || isReadiness(value.readiness));
}

function isHost(value: unknown): value is SourceRunHost {
  if (!isRecord(value) || typeof value.host_id !== "string" || typeof value.display_name !== "string") return false;
  const statuses = ["revoked", "offline", "failure", "awaiting_session", "ready"];
  const activeStates = [null, "claimed", "running"];
  const activeShape = value.active_run_id === null
    ? value.active_job === null && value.active_mode === null && value.active_state === null
    : typeof value.active_run_id === "number" && typeof value.active_job === "string"
      && isMode(value.active_mode) && (value.active_state === "claimed" || value.active_state === "running");
  return typeof value.enabled === "boolean" && statuses.includes(value.status as string)
    && isStringArray(value.lanes) && value.lanes.every(isLane)
    && isStringArray(value.supported_jobs) && isStringArray(value.artifact_homes)
    && isStringArray(value.capability_job_modes)
    && isStringArray(value.scheduled_job_modes)
    && isStringArray(value.manual_job_modes)
    && value.artifact_homes.every(isArtifactHome) && typeof value.session_ready === "boolean"
    && (value.failure_code === null || value.failure_code === "release_mismatch" || value.failure_code === "host_reported_unhealthy")
    && typeof value.executor_sha === "string" && typeof value.release_sha === "string"
    && typeof value.data_sha === "string" && isDateString(value.last_heartbeat_at)
    && isDateString(value.heartbeat_expires_at)
    && isNullableString(value.active_job) && (value.active_mode === null || isMode(value.active_mode))
    && activeStates.includes(value.active_state as null | string) && activeShape;
}

function isInventoryReadiness(value: unknown): value is InventoryReadiness {
  return isRecord(value)
    && typeof value.state === "string"
    && typeof value.reason_code === "string"
    && (value.host_name === undefined || isNullableString(value.host_name))
    && (value.lane === undefined || value.lane === null || isLane(value.lane))
    && (value.artifact_home === undefined || value.artifact_home === null || isArtifactHome(value.artifact_home));
}

function isInventoryRun(value: unknown): value is InventoryRunSummary {
  if (!isRecord(value) || typeof value.run_id !== "number" || !isMode(value.mode)
      || typeof value.state !== "string" || !isDateString(value.requested_at)) return false;
  return (value.claimed_at === undefined || isNullableDate(value.claimed_at))
    && (value.started_at === undefined || isNullableDate(value.started_at))
    && (value.finished_at === undefined || isNullableDate(value.finished_at))
    && (value.exit_code === undefined || value.exit_code === null || typeof value.exit_code === "number")
    && (value.claimed_by_host_name === undefined || isNullableString(value.claimed_by_host_name))
    && (value.evidence_ref === undefined || isNullableString(value.evidence_ref))
    && (value.evidence_sha256 === undefined || isNullableString(value.evidence_sha256))
    && (value.result_summary === undefined || isNullableString(value.result_summary))
    && (value.failure_code === undefined || isNullableString(value.failure_code));
}

function isTask(value: unknown): value is SourceRunTask {
  if (!isRecord(value)) return false;
  const lanes = ["http", "browser", "session", "maintenance"];
  const schedulePolicies = ["scheduled", "maintenance", "retired", "staged_activation"];
  const manualPolicies = ["safe", "session", "scheduled_only", "dangerous_confirmation", "unsupported"];
  const controlStates = ["manual_available", "confirmation_required", "scheduled_only", "unsupported", "retired"];
  const evidenceStates = ["managed", "no_managed_run", "unobserved_legacy"];
  return typeof value.task_name === "string" && typeof value.job === "string"
    && typeof value.cadence === "string" && lanes.includes(value.lane as string)
    && typeof value.session_required === "boolean" && isArtifactHome(value.artifact_home)
    && schedulePolicies.includes(value.schedule_policy as string)
    && manualPolicies.includes(value.manual_policy as string)
    && (value.manual_mode === null || isMode(value.manual_mode))
    && typeof value.policy_reason === "string"
    && (value.execution_path === "shared_shim" || value.execution_path === "legacy_direct")
    && (value.target_state === "documented_target" || value.target_state === "retired")
    && isInventoryReadiness(value.schedule_readiness)
    && isInventoryReadiness(value.manual_readiness)
    && controlStates.includes(value.control_state as string)
    && (value.active_run === null || isInventoryRun(value.active_run))
    && (value.latest_run === null || isInventoryRun(value.latest_run))
    && evidenceStates.includes(value.evidence_state as string);
}
