import { describe, expect, it } from "vitest";
import { annualizedReturn, bestOpportunity, calculateDealEconomics, netProceedsUsd, type ExitCostProfile } from "./deal-economics";
import { parseGradeSignal } from "./grade-signals";

const profile: ExitCostProfile = {
  platform: "ebay", feePct: 0.1, fixedFeeUsd: 0.4, shippingJpy: 1000,
  gradingCostJpy: 3500, gradingDays: 45, marginPct: 0.15, floorUsd: 0,
  updatedAt: "2026-07-20T00:00:00Z",
};

function signal(grade: number, exit: number, entry: number, days: number) {
  return parseGradeSignal({
    card_id: 1, psa_grade: grade, model_version: "s4-v1", computed_at: "2026-07-20T00:00:00Z",
    band_p10: exit * 0.9, band_p25: exit, band_p50: exit * 1.1, band_p75: exit * 1.2,
    days_to_exit_est: days, entry_at_default: entry, flags: {},
  });
}

describe("deal economics", () => {
  it("subtracts every configured exit cost", () => {
    expect(netProceedsUsd(100, profile, 0.0065, true)).toBeCloseTo(60.35);
  });

  it("annualizes by capital lockup", () => {
    expect(annualizedReturn(110, 100, 30)!).toBeGreaterThan(annualizedReturn(150, 100, 365)!);
  });

  it("chooses the best annualized grade, not the highest sticker exit", () => {
    const best = bestOpportunity([signal(10, 150, 100, 365), signal(9, 130, 100, 30)], 25, profile, 0.0065);
    expect(best?.signal.psaGrade).toBe(9);
  });

  it("includes grading cost and turnaround for a raw-card asking price", () => {
    const raw = calculateDealEconomics(signal(10, 150, 100, 30), 25, 100, profile, 0.0065, true)!;
    const graded = calculateDealEconomics(signal(10, 150, 100, 30), 25, 100, profile, 0.0065, false)!;
    expect(raw.netProceedsUsd).toBeLessThan(graded.netProceedsUsd);
    expect(raw.annualized!).toBeLessThan(graded.annualized!);
  });
});
