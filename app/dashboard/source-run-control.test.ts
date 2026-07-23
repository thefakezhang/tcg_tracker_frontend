import { describe, expect, it } from "vitest";

import {
  capabilityState,
  classifySnapshotError,
  durationSeconds,
  isSnapshot,
  shortSha,
  type SourceRun,
  type SourceRunHost,
} from "./source-run-control";

const host: SourceRunHost = {
  host_id: "main-pc",
  display_name: "Main PC",
  enabled: true,
  status: "ready",
  lanes: ["http", "browser", "session"],
  supported_jobs: ["cardladder"],
  artifact_homes: ["data-repo", "state-dir"],
  session_ready: true,
  failure_code: null,
  executor_sha: "0123456789abcdef",
  release_sha: "0123456789abcdef",
  data_sha: "fedcba9876543210",
  last_heartbeat_at: "2026-07-22T12:00:00Z",
  heartbeat_expires_at: "2026-07-22T12:03:00Z",
  active_run_id: null,
  active_job: null,
  active_mode: null,
  active_state: null,
};

const run: SourceRun = {
  run_id: 42,
  job: "cardladder",
  mode: "full",
  state: "running",
  display_state: "running",
  requested_at: "2026-07-22T12:00:00Z",
  claimed_at: "2026-07-22T12:01:00Z",
  started_at: "2026-07-22T12:02:00Z",
  finished_at: null,
  exit_code: null,
  claim_attempt_count: 1,
  claimed_by_host_id: "main-pc",
  claimed_by_host_name: "Main PC",
  executor_sha: "0123456789abcdef",
  release_sha: "0123456789abcdef",
  data_sha: "fedcba9876543210",
  evidence_ref: null,
  evidence_sha256: null,
  result_summary: null,
  failure_code: null,
  readiness: null,
};

describe("source-run control helpers", () => {
  it("prioritizes host safety states over advertised lanes", () => {
    expect(capabilityState(host, "session")).toBe("ready");
    expect(capabilityState({ ...host, session_ready: false }, "session")).toBe("awaiting_session");
    expect(capabilityState({ ...host, lanes: ["http"] }, "browser")).toBe("unsupported");
    expect(capabilityState({ ...host, status: "offline" }, "http")).toBe("offline");
    expect(capabilityState({ ...host, status: "failure" }, "http")).toBe("failure");
    expect(capabilityState({ ...host, enabled: false }, "http")).toBe("revoked");
  });

  it("formats immutable revision evidence and bounded durations", () => {
    expect(shortSha(host.executor_sha)).toBe("01234567");
    expect(shortSha(null)).toBe("-");
    expect(durationSeconds(run, new Date("2026-07-22T12:02:37Z"))).toBe(37);
    expect(durationSeconds({ ...run, started_at: "invalid" }, new Date())).toBeNull();
  });

  it("rejects malformed snapshot envelopes", () => {
    expect(isSnapshot({ server_time: "2026-07-22T12:00:00Z", jobs: [], runs: [], hosts: [] })).toBe(true);
    expect(isSnapshot({ server_time: "2026-07-22T12:00:00Z", jobs: [], runs: [] })).toBe(false);
    expect(isSnapshot({
      server_time: "2026-07-22T12:00:00Z",
      jobs: [{
        job: "cardladder", family: "file-source", fetch_lane: "session",
        artifact_home: "data-repo", expected_minutes_full: 45, min_interval_hours: 0,
        modes: { full: { lane: "session", meaning: "fetch" } }, readiness: {},
      }],
      runs: [], hosts: [],
    })).toBe(false);
    expect(isSnapshot({
      server_time: "2026-07-22T12:00:00Z",
      jobs: [],
      runs: [],
      hosts: [{
        ...host,
        supported_jobs: [],
        artifact_homes: ["object-store"],
      }],
    })).toBe(false);
    expect(isSnapshot(null)).toBe(false);
  });

  it("accepts redacted scoped-busy readiness and rejects leaked collision details", () => {
    const busy = {
      server_time: "2026-07-22T12:00:00Z",
      jobs: [{
        job: "snkrdunk-catalog", family: "marketplace", fetch_lane: "browser",
        artifact_home: "data-repo", expected_minutes_full: 30, min_interval_hours: 12,
        modes: { reprocess: { lane: "http", meaning: "reprocess" } },
        readiness: { reprocess: {
          state: "queued_scope_busy", reason_code: "scope_busy", host_name: null,
          lane: "http", artifact_home: "data-repo",
        } },
      }],
      runs: [], hosts: [],
    };
    expect(isSnapshot(busy)).toBe(true);
    expect(isSnapshot({
      ...busy,
      jobs: [{
        ...busy.jobs[0],
        readiness: { reprocess: {
          ...busy.jobs[0].readiness.reprocess,
          collision_keys: ["source:snkrdunk"],
        } },
      }],
    })).toBe(false);
  });

  it("accepts the redacted fail-closed remote activation state", () => {
    expect(isSnapshot({
      server_time: "2026-07-22T12:00:00Z",
      jobs: [{
        job: "toban", family: "marketplace", fetch_lane: "http",
        artifact_home: "data-repo", expected_minutes_full: 20, min_interval_hours: 8,
        modes: { full: { lane: "http", meaning: "fetch" } },
        readiness: { full: {
          state: "deferred_unsupported", reason_code: "remote_not_enabled", host_name: null,
          lane: "http", artifact_home: "data-repo",
        } },
      }],
      runs: [], hosts: [],
    })).toBe(true);
  });

  it("rejects scheduler-only run and host activity outside the visible job registry", () => {
    const base = {
      server_time: "2026-07-22T12:00:00Z",
      jobs: [], runs: [], hosts: [],
    };
    expect(isSnapshot({
      ...base,
      runs: [{ ...run, job: "update-market-listings" }],
    })).toBe(false);
    expect(isSnapshot({
      ...base,
      hosts: [{
        ...host,
        active_run_id: 99,
        active_job: "update-market-listings",
        active_mode: "full",
        active_state: "running",
      }],
    })).toBe(false);
  });

  it("classifies authorization, network, and server failures without echoing details", () => {
    expect(classifySnapshotError({ code: "42501", message: "private role detail" })).toBe("restricted");
    expect(classifySnapshotError({ status: 403, message: "forbidden" })).toBe("restricted");
    expect(classifySnapshotError(new TypeError("fetch failed for secret endpoint"))).toBe("network");
    expect(classifySnapshotError({ code: "XX000", message: "database detail" })).toBe("server");
  });
});
