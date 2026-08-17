// Shared money / FX helpers, so USD formatting and native->USD conversion live in
// one place instead of being copy-pasted per component. The rate map is the one
// from `fetchRateMap` (from_currency -> rate to USD).

// "$1,234.56" — two-decimal USD, the accounting/statement format. Negatives
// carry the sign before the symbol ("-$12.34"), never "$-12.34".
export function formatUsd(n: number): string {
  // Round half away from zero on the magnitude (Math.round alone rounds -1.5 to -1).
  const cents = Math.round(Math.abs(n ?? 0) * 100);
  const abs = (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${(n ?? 0) < 0 && cents > 0 ? "-" : ""}$${abs}`;
}

// "$1,235" — whole-dollar USD, for compact summaries.
export function formatUsdWhole(n: number): string {
  const dollars = Math.round(Math.abs(n ?? 0));
  return `${(n ?? 0) < 0 && dollars > 0 ? "-" : ""}$${dollars.toLocaleString()}`;
}

// "$1,235" above $100, "$12.34" below — the dense browse-table format, where
// cents matter on cheap cards and only add noise on expensive ones.
export function formatUsdCompact(n: number): string {
  return n >= 100 ? formatUsdWhole(n) : formatUsd(n);
}

// "¥1,235" — JPY is never shown with fractions.
export function formatJpy(n: number): string {
  return `¥${Math.round(n ?? 0).toLocaleString()}`;
}

// Market ROI as shown in the browse tables: up to two decimals, no padding,
// no sign ("12.5%", "1234.57%"), em dash when unknown. Theoretical / realized
// returns use formatRoiPct (theoretical-roi.ts), which is signed and 1dp - a
// different meaning, deliberately a different look.
export function formatRoi(roi: number | null | undefined): string {
  if (roi == null || !Number.isFinite(roi)) return "\u2014";
  return `${Math.round(roi * 100) / 100}%`;
}

// Convert a native price to USD via the session rate map (unknown currency -> 1:1).
export function toUsd(price: number, currency: string, rateMap: Map<string, number>): number {
  return price * (rateMap.get(currency) ?? 1);
}
