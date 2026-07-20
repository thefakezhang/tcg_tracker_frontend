import { describe, expect, it } from "vitest";
import {
  eventAppliesToCard,
  exitValue,
  isHighValueWeakEvidence,
  latestSignals,
  parseGradeSignal,
} from "./grade-signals";

const base = {
  card_id: 42,
  psa_grade: 10,
  model_version: "s2-v2",
  computed_at: "2026-07-20T22:54:47Z",
  band_p10: "8000",
  band_p25: "9000",
  band_p50: "10000",
  flags: { thin_evidence: true },
};

describe("grade signal presentation helpers", () => {
  it("parses Postgres numerics and keeps only the newest model row per grade", () => {
    const older = { ...base, model_version: "s2-v1", computed_at: "2026-07-19T22:54:47Z" };
    const signals = latestSignals([older, base]);
    expect(signals).toHaveLength(1);
    expect(signals[0].modelVersion).toBe("s2-v2");
    expect(signals[0].bandP25).toBe(9000);
    expect(signals[0].flags.thin_evidence).toBe(true);
  });

  it("prefers the higher model version when snapshots have the same timestamp", () => {
    const prior = { ...base, model_version: "s2-v1" };
    expect(latestSignals([prior, base])[0].modelVersion).toBe("s2-v2");
  });

  it("uses the persisted percentile as a transparent exit basis", () => {
    const signal = parseGradeSignal(base);
    expect(exitValue(signal, 10)).toBe(8000);
    expect(exitValue(signal, 25)).toBe(9000);
    expect(exitValue(signal, 50)).toBe(10000);
  });

  it("surfaces high-value rows whose evidence is below Tier 1 or 2", () => {
    expect(isHighValueWeakEvidence(parseGradeSignal({ ...base, band_p50: 75_000, tier: "tier_3_ask" }))).toBe(true);
    expect(isHighValueWeakEvidence(parseGradeSignal({ ...base, band_p50: 75_000, tier: "tier_2" }))).toBe(false);
  });

  it("matches global, set, and explicit card events", () => {
    const event = { eventId: 1, startsOn: "2026-07-31", endsOn: null, scopeRef: null, cardIds: null, title: "x", kind: "set_release", confidence: "confirmed" };
    expect(eventAppliesToCard({ ...event, scope: "global" }, 42, "M6")).toBe(true);
    expect(eventAppliesToCard({ ...event, scope: "set", scopeRef: "m6" }, 42, "M6")).toBe(true);
    expect(eventAppliesToCard({ ...event, scope: "card_list", cardIds: [42] }, 42, "M6")).toBe(true);
    expect(eventAppliesToCard({ ...event, scope: "card_list", cardIds: [7] }, 42, "M6")).toBe(false);
  });
});
