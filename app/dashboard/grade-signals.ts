import type { CardRowData } from "./use-card-data";
import type { ExitPercentile } from "./ExitBasisContext";

export interface GradeSignalFlags {
  thin_evidence?: boolean;
  cohort_derived?: boolean;
  cohort_own_weight?: number;
  cohort_level?: string;
  inversion_derived?: boolean;
  inversion_confidence?: number;
  [key: string]: unknown;
}

export interface GradeSignal {
  cardId: number;
  psaGrade: number;
  modelVersion: string;
  computedAt: string;
  tier: string | null;
  bestJpBidJpy: number | null;
  bestJpBidLocation: number | null;
  bestJpBidAgeDays: number | null;
  bandP10: number | null;
  bandP25: number | null;
  bandP50: number | null;
  bandP75: number | null;
  lastSaleJpy: number | null;
  lastSaleAt: string | null;
  trendSlope: number | null;
  trendDirection: string | null;
  compCountRecent: number | null;
  compCountLifetime: number | null;
  listingCount: number | null;
  sellThrough: number | null;
  clearingVsAsk: number | null;
  daysToExitEst: number | null;
  cohort: string | null;
  pop: number | null;
  popVelocity: number | null;
  entryAtDefault: number | null;
  netAtDefault: number | null;
  annualizedAtDefault: number | null;
  exitPlatform: string | null;
  rawToGradeEvUsd: number | null;
  relativeValuePct: number | null;
  flags: GradeSignalFlags;
}

export interface SlabSale {
  grade: number;
  saleDate: string | null;
  priceUsd: number;
  platform: string | null;
}

export interface SignalEvent {
  eventId: number;
  startsOn: string;
  endsOn: string | null;
  scope: string;
  scopeRef: string | null;
  cardIds: number[] | null;
  title: string;
  kind: string;
  confidence: string;
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseGradeSignal(row: Record<string, unknown>): GradeSignal {
  const rawFlags = row.flags;
  const flags = rawFlags && typeof rawFlags === "object" && !Array.isArray(rawFlags)
    ? rawFlags as GradeSignalFlags
    : {};
  return {
    cardId: Number(row.card_id),
    psaGrade: Number(row.psa_grade),
    modelVersion: String(row.model_version),
    computedAt: String(row.computed_at),
    tier: row.tier == null ? null : String(row.tier),
    bestJpBidJpy: nullableNumber(row.best_jp_bid_jpy),
    bestJpBidLocation: nullableNumber(row.best_jp_bid_location),
    bestJpBidAgeDays: nullableNumber(row.best_jp_bid_age_days),
    bandP10: nullableNumber(row.band_p10),
    bandP25: nullableNumber(row.band_p25),
    bandP50: nullableNumber(row.band_p50),
    bandP75: nullableNumber(row.band_p75),
    lastSaleJpy: nullableNumber(row.last_sale_jpy),
    lastSaleAt: row.last_sale_at == null ? null : String(row.last_sale_at),
    trendSlope: nullableNumber(row.trend_slope),
    trendDirection: row.trend_direction == null ? null : String(row.trend_direction),
    compCountRecent: nullableNumber(row.comp_count_recent),
    compCountLifetime: nullableNumber(row.comp_count_lifetime),
    listingCount: nullableNumber(row.listing_count),
    sellThrough: nullableNumber(row.sell_through),
    clearingVsAsk: nullableNumber(row.clearing_vs_ask),
    daysToExitEst: nullableNumber(row.days_to_exit_est),
    cohort: row.cohort == null ? null : String(row.cohort),
    pop: nullableNumber(row.pop),
    popVelocity: nullableNumber(row.pop_velocity),
    entryAtDefault: nullableNumber(row.entry_at_default),
    netAtDefault: nullableNumber(row.net_at_default),
    annualizedAtDefault: nullableNumber(row.annualized_at_default),
    exitPlatform: row.exit_platform == null ? null : String(row.exit_platform),
    rawToGradeEvUsd: nullableNumber(row.raw_to_grade_ev_usd),
    relativeValuePct: nullableNumber(row.relative_value_pct),
    flags,
  };
}

export function latestSignals(rows: Record<string, unknown>[]): GradeSignal[] {
  const sorted = rows.map(parseGradeSignal).sort((a, b) =>
    b.computedAt.localeCompare(a.computedAt) || b.modelVersion.localeCompare(a.modelVersion),
  );
  const seen = new Set<string>();
  return sorted.filter((signal) => {
    const key = `${signal.cardId}:${signal.psaGrade}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function exitValue(signal: GradeSignal | null | undefined, percentile: ExitPercentile): number | null {
  if (!signal) return null;
  if (percentile === 10) return signal.bandP10;
  if (percentile === 50) return signal.bandP50;
  return signal.bandP25;
}

export function signalForRow(row: CardRowData, signals: GradeSignal[]): GradeSignal | null {
  const grade = row.psaGrade ?? 0;
  return signals.find((signal) => signal.cardId === Number(row.card.card_id) && signal.psaGrade === grade) ?? null;
}

export function isHighValueWeakEvidence(signal: GradeSignal | null | undefined, jpyUsd: number | null | undefined): boolean {
  if (!signal) return false;
  // Grade bands are JPY. Convert the median with the loaded as-of rate before
  // applying the USD product threshold; no FX means no currency-safe verdict.
  if (signal.bandP50 == null || jpyUsd == null || jpyUsd <= 0 || signal.bandP50 * jpyUsd < 300) return false;
  return signal.tier !== "tier_1" && signal.tier !== "tier_2";
}

export function eventAppliesToCard(event: SignalEvent, cardId: number, setCode: string): boolean {
  if (event.scope === "global") return true;
  if (event.scope === "set") return event.scopeRef?.toUpperCase() === setCode.toUpperCase();
  if (event.scope === "card_list") return event.cardIds?.includes(cardId) ?? false;
  return false;
}
