// Shared money / FX helpers, so USD formatting and native->USD conversion live in
// one place instead of being copy-pasted per component. The rate map is the one
// from `fetchRateMap` (from_currency -> rate to USD).

// "$1,234.56" — two-decimal USD, the accounting/statement format.
export function formatUsd(n: number): string {
  return `$${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// "$1,235" — whole-dollar USD, for compact summaries.
export function formatUsdWhole(n: number): string {
  return `$${Math.round(n ?? 0).toLocaleString()}`;
}

// Convert a native price to USD via the session rate map (unknown currency -> 1:1).
export function toUsd(price: number, currency: string, rateMap: Map<string, number>): number {
  return price * (rateMap.get(currency) ?? 1);
}
