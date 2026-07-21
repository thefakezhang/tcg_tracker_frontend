import type { ExitPercentile } from "./ExitBasisContext";
import { exitValue, type GradeSignal } from "./grade-signals";

export interface ExitCostProfile {
  platform: string;
  feePct: number;
  fixedFeeUsd: number;
  shippingJpy: number;
  gradingCostJpy: number | null;
  gradingDays: number | null;
  marginPct: number;
  floorUsd: number;
  updatedAt: string;
}

export interface CalculatedDealEconomics {
  signal: GradeSignal;
  exitUsd: number;
  entryUsd: number;
  netProceedsUsd: number;
  netPnlUsd: number;
  annualized: number | null;
}

export function parseExitCostProfile(row: Record<string, unknown>): ExitCostProfile {
  const number = (value: unknown) => Number(value ?? 0);
  return {
    platform: String(row.platform),
    feePct: number(row.fee_pct),
    fixedFeeUsd: number(row.fixed_fee),
    shippingJpy: number(row.shipping_jpy),
    gradingCostJpy: row.grading_cost_jpy == null ? null : number(row.grading_cost_jpy),
    gradingDays: row.grading_days == null ? null : number(row.grading_days),
    marginPct: number(row.margin_pct),
    floorUsd: number(row.floor_usd),
    updatedAt: String(row.updated_at),
  };
}

export function netProceedsUsd(
  exitUsd: number,
  profile: ExitCostProfile,
  jpyUsd: number,
  includeGrading = false,
): number {
  let proceeds = exitUsd * (1 - profile.feePct) - profile.fixedFeeUsd - profile.shippingJpy * jpyUsd;
  if (includeGrading && profile.gradingCostJpy != null) {
    proceeds -= profile.gradingCostJpy * jpyUsd;
  }
  return proceeds;
}

export function annualizedReturn(netProceeds: number, entryUsd: number, days: number): number | null {
  if (netProceeds <= 0 || entryUsd <= 0 || days <= 0) return null;
  const value = Math.pow(netProceeds / entryUsd, 365 / days) - 1;
  return Number.isFinite(value) ? value : null;
}

export function calculateDealEconomics(
  signal: GradeSignal,
  percentile: ExitPercentile,
  entryUsd: number,
  profile: ExitCostProfile,
  jpyUsd: number,
  includeGrading = false,
): CalculatedDealEconomics | null {
  const exitUsd = exitValue(signal, percentile);
  if (exitUsd == null || entryUsd <= 0 || signal.daysToExitEst == null) return null;
  const proceeds = netProceedsUsd(exitUsd, profile, jpyUsd, includeGrading);
  const days = signal.daysToExitEst + (includeGrading ? profile.gradingDays ?? 0 : 0);
  return {
    signal,
    exitUsd,
    entryUsd,
    netProceedsUsd: proceeds,
    netPnlUsd: proceeds - entryUsd,
    annualized: annualizedReturn(proceeds, entryUsd, days),
  };
}

export function bestOpportunity(
  signals: GradeSignal[],
  percentile: ExitPercentile,
  profile: ExitCostProfile,
  jpyUsd: number,
): CalculatedDealEconomics | null {
  return signals.reduce<CalculatedDealEconomics | null>((best, signal) => {
    if (signal.entryAtDefault == null) return best;
    const candidate = calculateDealEconomics(signal, percentile, signal.entryAtDefault, profile, jpyUsd);
    if (!candidate || candidate.annualized == null) return best;
    return !best || best.annualized == null || candidate.annualized > best.annualized ? candidate : best;
  }, null);
}
