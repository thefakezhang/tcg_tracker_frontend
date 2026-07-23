// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { SourceRunsPanel } from "./SourceRunsPanel";
import type { SourceRunSnapshot } from "./source-run-control";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  t: (key: string, params?: Record<string, string | number>) => {
    if (!params) return key;
    return `${key} ${Object.values(params).join(" ")}`;
  },
}));

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ t: mocks.t }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));

const snapshot: SourceRunSnapshot = {
  server_time: "2026-07-22T12:15:00Z",
  jobs: [{
    job: "cardladder",
    family: "marketplace",
    fetch_lane: "session",
    artifact_home: "data-repo",
    modes: {
      report: { lane: "http", meaning: "Read the current artifact and produce a report." },
      full: { lane: "session", meaning: "Fetch Card Ladder through the signed-in browser session, then process and publish." },
    },
    readiness: {
      report: {
        state: "eligible", reason_code: "ready", host_name: "Main PC",
        lane: "http", artifact_home: "data-repo",
      },
      full: {
        state: "awaiting_session", reason_code: "awaiting_session", host_name: "Main PC",
        lane: "session", artifact_home: "data-repo",
      },
    },
    expected_minutes_full: 18,
    min_interval_hours: 8,
  }],
  hosts: [{
    host_id: "main-pc",
    display_name: "Main PC",
    enabled: true,
    status: "awaiting_session",
    lanes: ["http", "browser", "session"],
    supported_jobs: ["cardladder"],
    artifact_homes: ["data-repo", "state-dir"],
    session_ready: false,
    failure_code: null,
    executor_sha: "0123456789abcdef",
    release_sha: "0123456789abcdef",
    data_sha: "fedcba9876543210",
    last_heartbeat_at: "2026-07-22T12:14:30Z",
    heartbeat_expires_at: "2026-07-22T12:17:30Z",
    active_run_id: 5,
    active_job: "cardladder",
    active_mode: "report",
    active_state: "claimed",
  }],
  runs: [{
    run_id: 7,
    job: "cardladder",
    mode: "full",
    state: "pending",
    display_state: "awaiting_session",
    requested_at: "2026-07-22T12:10:00Z",
    claimed_at: null,
    started_at: null,
    finished_at: null,
    exit_code: null,
    claim_attempt_count: 0,
    claimed_by_host_id: null,
    claimed_by_host_name: null,
    executor_sha: null,
    release_sha: null,
    data_sha: null,
    evidence_ref: null,
    evidence_sha256: null,
    result_summary: null,
    failure_code: null,
    readiness: {
      state: "awaiting_session", reason_code: "awaiting_session", host_name: "Main PC",
      lane: "session", artifact_home: "data-repo",
    },
  }, {
    run_id: 6,
    job: "cardladder",
    mode: "report",
    state: "error",
    display_state: "error",
    requested_at: "2026-07-22T11:00:00Z",
    claimed_at: "2026-07-22T11:00:05Z",
    started_at: "2026-07-22T11:00:06Z",
    finished_at: "2026-07-22T11:00:16Z",
    exit_code: 17,
    claim_attempt_count: 2,
    claimed_by_host_id: "main-pc",
    claimed_by_host_name: "Main PC",
    executor_sha: "0123456789abcdef",
    release_sha: "0123456789abcdef",
    data_sha: "fedcba9876543210",
    evidence_ref: "source-run:6:cardladder:report",
    evidence_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    result_summary: "Run failed with exit 17; inspect the host evidence reference.",
    failure_code: "exit_17",
    readiness: null,
  }, {
    run_id: 5,
    job: "cardladder",
    mode: "report",
    state: "claimed",
    display_state: "claimed",
    requested_at: "2026-07-22T10:00:00Z",
    claimed_at: "2026-07-22T10:00:05Z",
    started_at: null,
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
  }],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SourceRunsPanel", () => {
  it("shows truthful host readiness, safe evidence, and a mobile-safe mode control", async () => {
    mocks.rpc.mockResolvedValue({ data: snapshot, error: null });
    render(<SourceRunsPanel />);

    const host = await screen.findByTestId("run-host-main-pc");
    expect(within(host).getByText("runs.hostStatus.awaiting_session")).toBeTruthy();
    expect(within(host).getByText("runs.lane.session: runs.capability.awaiting_session")).toBeTruthy();
    expect(within(host).getByText("runs.hostJobs: cardladder")).toBeTruthy();
    expect(within(host).getByText("runs.artifactHomes: data-repo, state-dir")).toBeTruthy();
    expect(within(host).getByText(/runs\.hostActive\.claimed/)).toBeTruthy();
    expect(screen.getAllByText(/runs.readiness.awaiting_session/).length).toBeGreaterThanOrEqual(1);

    const completedRun = screen.getByTestId("source-run-6");
    expect(within(completedRun).getByText(/exec 01234567/)).toBeTruthy();
    expect(within(completedRun).getByText("source-run:6:cardladder:report")).toBeTruthy();
    expect(within(completedRun).getByText(/runs\.attemptCount 2/)).toBeTruthy();
    expect(within(completedRun).getByText(/runs.exitCode 17/)).toBeTruthy();
    expect(within(completedRun).getByText("runs.partialExecutionWarning")).toBeTruthy();
    expect(within(completedRun).getByText("runs.evidence").className).toContain("min-h-11");
    expect(within(completedRun).queryByText("lease_token")).toBeNull();
    expect(within(screen.getByTestId("source-run-5")).getByText(/runs.claimedAt/)).toBeTruthy();

    const jobCard = screen.getByText("cardladder").closest("article");
    expect(jobCard).not.toBeNull();
    const fullButton = within(jobCard!).getByRole("button", { name: "runs.mode.full" });
    expect(fullButton.className).toContain("min-h-11");
    expect(fullButton.className).toContain("w-full");
    fireEvent.click(fullButton);

    expect(await screen.findByText(snapshot.jobs[0].modes.full!.meaning)).toBeTruthy();
    expect(screen.getByText("runs.confirmLane runs.lane.session")).toBeTruthy();
    expect(screen.getByText("runs.confirmMayRunLater")).toBeTruthy();
    expect(screen.getByText("runs.expected 18")).toBeTruthy();
  });

  it("labels a running host separately from a claimed lease", async () => {
    const running = structuredClone(snapshot);
    running.hosts[0].active_state = "running";
    running.hosts[0].active_run_id = 4;
    running.runs = running.runs.filter((candidate) => candidate.run_id !== 5);
    running.runs.push({
      ...snapshot.runs[2],
      run_id: 4,
      state: "running",
      display_state: "running",
      started_at: "2026-07-22T10:00:06Z",
    });
    mocks.rpc.mockResolvedValue({ data: running, error: null });
    render(<SourceRunsPanel />);

    const host = await screen.findByTestId("run-host-main-pc");
    expect(within(host).getByText(/runs\.hostActive\.running/)).toBeTruthy();
    expect(within(screen.getByTestId("source-run-4")).getByText(/runs.startedAt/)).toBeTruthy();
    expect(within(host).queryByText(/runs\.hostActive\.claimed/)).toBeNull();
  });

  it("shows a redacted protected-scope wait in the run and confirmation", async () => {
    const busy = structuredClone(snapshot);
    busy.jobs[0].readiness.full = {
      state: "queued_scope_busy", reason_code: "scope_busy", host_name: null,
      lane: "session", artifact_home: "data-repo",
    };
    busy.runs[0].display_state = "queued_scope_busy";
    busy.runs[0].readiness = busy.jobs[0].readiness.full;
    mocks.rpc.mockResolvedValue({ data: busy, error: null });
    render(<SourceRunsPanel />);

    expect((await screen.findAllByText("runs.state.queued_scope_busy")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/runs\.readiness\.scope_busy/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/source:|collision_keys/)).toBeNull();

    const jobCard = screen.getByText("cardladder").closest("article");
    fireEvent.click(within(jobCard!).getByRole("button", { name: "runs.mode.full" }));
    expect(await screen.findByText("runs.confirmScopeBusy")).toBeTruthy();
    expect(screen.queryByText("runs.confirmQueuesSoon")).toBeNull();
  });

  it("shows an unsupported remote tuple as deferred and cannot enqueue it", async () => {
    const unsupported = structuredClone(snapshot);
    unsupported.jobs[0].readiness.full = {
      state: "deferred_unsupported", reason_code: "remote_not_enabled", host_name: null,
      lane: "session", artifact_home: "data-repo",
    };
    unsupported.runs = unsupported.runs.filter((run) => run.mode !== "full");
    mocks.rpc.mockResolvedValue({ data: unsupported, error: null });
    render(<SourceRunsPanel />);

    const jobCard = (await screen.findByText("cardladder")).closest("article");
    const fullButton = within(jobCard!).getByRole("button", { name: "runs.mode.full" });
    expect((fullButton as HTMLButtonElement).disabled).toBe(true);
    expect(within(jobCard!).getByText(/runs\.readiness\.remote_not_enabled/)).toBeTruthy();

    fireEvent.click(fullButton);
    expect(screen.queryByText(unsupported.jobs[0].modes.full!.meaning)).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalledWith("request_source_run", expect.anything());
  });

  it("renders a fail-closed remote-unsupported verdict if readiness changes during a request", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "request_source_run"
      ? { data: { verdict: "remote_unsupported", job: "cardladder", mode: "full" }, error: null }
      : { data: snapshot, error: null });
    render(<SourceRunsPanel />);

    const jobCard = (await screen.findByText("cardladder")).closest("article");
    fireEvent.click(within(jobCard!).getByRole("button", { name: "runs.mode.full" }));
    fireEvent.click(await screen.findByRole("button", { name: "runs.start" }));

    expect(await screen.findByText("runs.remoteUnsupported cardladder full")).toBeTruthy();
  });

  it("queues only after confirmation and refreshes the control snapshot", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "request_source_run"
      ? { data: { verdict: "queued", job: "cardladder", mode: "full" }, error: null }
      : { data: snapshot, error: null });
    render(<SourceRunsPanel />);

    const jobCard = (await screen.findByText("cardladder")).closest("article");
    fireEvent.click(within(jobCard!).getByRole("button", { name: "runs.mode.full" }));
    fireEvent.click(await screen.findByRole("button", { name: "runs.start" }));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith("request_source_run", {
        p_job: "cardladder",
        p_mode: "full",
      });
      expect(mocks.rpc).toHaveBeenCalledWith("source_run_control_snapshot", { p_run_limit: 30 });
    });
    expect(await screen.findByText("runs.queued cardladder full")).toBeTruthy();
  });

  it("does not disclose backend authorization errors", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "operator table detail" } });
    render(<SourceRunsPanel />);

    expect(await screen.findByText("runs.issue.restricted.title")).toBeTruthy();
    expect(screen.getByText("runs.issue.restricted.body")).toBeTruthy();
    expect(screen.queryByText("operator table detail")).toBeNull();
  });

  it("does not echo enqueue infrastructure details", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "request_source_run"
      ? { data: null, error: { message: "database host and role detail" } }
      : { data: snapshot, error: null });
    render(<SourceRunsPanel />);

    const jobCard = (await screen.findByText("cardladder")).closest("article");
    fireEvent.click(within(jobCard!).getByRole("button", { name: "runs.mode.full" }));
    fireEvent.click(await screen.findByRole("button", { name: "runs.start" }));

    expect(await screen.findByText("runs.requestFailed")).toBeTruthy();
    expect(screen.queryByText("database host and role detail")).toBeNull();
  });

  it("cancels an unclaimed run and retains prior data through a network failure", async () => {
    let snapshotCalls = 0;
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "cancel_source_run") {
        return { data: { verdict: "cancelled", job: "cardladder", mode: "full" }, error: null };
      }
      snapshotCalls += 1;
      if (snapshotCalls === 1) return { data: snapshot, error: null };
      throw new TypeError("fetch failed at private endpoint");
    });
    render(<SourceRunsPanel />);

    const pendingRun = await screen.findByTestId("source-run-7");
    fireEvent.click(within(pendingRun).getByRole("button", { name: "runs.cancelQueued" }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("cancel_source_run", { p_run_id: 7 }));
    expect(await screen.findByText("runs.cancelled cardladder full")).toBeTruthy();
    expect(await screen.findByText("runs.issue.network.title")).toBeTruthy();
    expect(screen.getByText(/runs.showingPrior/)).toBeTruthy();
    expect(screen.getByTestId("source-run-7")).toBeTruthy();
    expect(screen.queryByText("private endpoint")).toBeNull();
  });

  it("labels malformed snapshots without guessing at their contents", async () => {
    mocks.rpc.mockResolvedValue({
      data: { server_time: "2026-07-22T12:15:00Z", jobs: [{}], runs: [], hosts: [] },
      error: null,
    });
    render(<SourceRunsPanel />);

    expect(await screen.findByText("runs.issue.malformed.title")).toBeTruthy();
    expect(screen.getByText("runs.issue.malformed.body")).toBeTruthy();
  });

  it("does not render scheduler-only activity outside the visible registry", async () => {
    const leaked = structuredClone(snapshot);
    leaked.runs.push({ ...leaked.runs[2], run_id: 99, job: "update-market-listings" });
    leaked.hosts[0].active_run_id = 99;
    leaked.hosts[0].active_job = "update-market-listings";
    leaked.hosts[0].active_mode = "full";
    leaked.hosts[0].active_state = "running";
    mocks.rpc.mockResolvedValue({ data: leaked, error: null });
    render(<SourceRunsPanel />);

    expect(await screen.findByText("runs.issue.malformed.title")).toBeTruthy();
    expect(screen.queryByText("update-market-listings")).toBeNull();
  });

  it("distinguishes an online artifact-incapable host and shows only controlled host failure", async () => {
    const incapable = structuredClone(snapshot);
    incapable.runs[0].display_state = "host_incapable";
    incapable.runs[0].readiness = {
      state: "host_incapable", reason_code: "artifact_unavailable", host_name: null,
      lane: "http", artifact_home: "data-repo",
    };
    incapable.hosts[0].status = "failure";
    incapable.hosts[0].failure_code = "host_reported_unhealthy";
    mocks.rpc.mockResolvedValue({ data: incapable, error: null });
    render(<SourceRunsPanel />);

    expect((await screen.findAllByText("runs.state.host_incapable")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/runs.readiness.artifact_unavailable/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("runs.hostFailure.host_reported_unhealthy")).toBeTruthy();
  });
});
