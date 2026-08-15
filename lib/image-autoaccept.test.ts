import { describe, expect, it } from "vitest";
import {
  calibrationProgress,
  parseAutoAcceptStatus,
  percent,
  unreviewedSamples,
} from "./image-autoaccept";

describe("image auto-accept status", () => {
  it("parses the database payload fail-closed", () => {
    const status = parseAutoAcceptStatus({
      control: { global_enabled: true, daily_cap: 25, reason: "canary", updated_at: "now" },
      sources: [{
        source: "alice", kind: "singles", fingerprint: "a".repeat(64),
        sampled: 400, reviewed: 381, successes: 381, failures: 0, excluded: 4,
        wilson_lower_95: 0.99002, calibration_ready: true,
        canary_passed: true, eligible_revisions: 900, total_revisions: 1200, enabled: true,
      }, { source: "invalid", kind: "other" }],
      recent_runs: [{
        run_uid: "run", started_at: "now", requested_cap: 5,
        execution_mode: "operator_canary", reason: "manual first batch",
        summary: { promoted: 2 }, status: "completed",
      }],
    });

    expect(status.control.global_enabled).toBe(true);
    expect(status.sources).toHaveLength(1);
    expect(status.sources[0].calibration_ready).toBe(true);
    expect(status.sources[0].canary_passed).toBe(true);
    expect(status.recent_runs[0].summary.promoted).toBe(2);
    expect(status.recent_runs[0].execution_mode).toBe("operator_canary");
    expect(status.recent_runs[0].reason).toBe("manual first batch");
  });

  it("reports the fixed 381-review gate and remaining queue", () => {
    const source = parseAutoAcceptStatus({
      sources: [{
        source: "laurier", kind: "singles", fingerprint: "b".repeat(64),
        sampled: 300, reviewed: 100, excluded: 10,
      }],
    }).sources[0];

    expect(calibrationProgress(source)).toBe(26);
    expect(unreviewedSamples(source)).toBe(190);
    expect(percent(0.99002)).toBe("99.00%");
    expect(percent(null)).toBe("-");
  });
});
