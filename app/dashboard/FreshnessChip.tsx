"use client";

// Tiny colored dot rendered next to a listing's source/location to make
// stale prices obvious at a glance. The thresholds come straight from the
// product brief: green within 24 hours of last_updated, amber within
// three days, red beyond. Hovering shows the actual age as a tooltip so
// the curator can decide whether to act on a borderline row without
// pulling up timestamps.
//
// last_updated comes from pokemon_market_listings / pokemon_sealed_market_listings.
// The 7-day prune cron (a sibling PR) will delete rows older than that
// outright, so anything older than 7d shouldn't appear in practice;
// the red chip caps at that until proven otherwise.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function freshnessTier(lastUpdated: string | null | undefined, now = Date.now()): "fresh" | "stale" | "old" | null {
  if (!lastUpdated) return null;
  const t = Date.parse(lastUpdated);
  if (!Number.isFinite(t)) return null;
  const age = now - t;
  if (age <= DAY_MS) return "fresh";
  if (age <= 3 * DAY_MS) return "stale";
  return "old";
}

function ageLabel(lastUpdated: string, now = Date.now()): string {
  const age = now - Date.parse(lastUpdated);
  if (age < HOUR_MS) return `${Math.max(1, Math.round(age / (60 * 1000)))} min ago`;
  if (age < DAY_MS) return `${Math.round(age / HOUR_MS)} h ago`;
  return `${Math.round(age / DAY_MS)} d ago`;
}

export function FreshnessChip({ lastUpdated }: { lastUpdated: string | null | undefined }) {
  const tier = freshnessTier(lastUpdated);
  if (!tier || !lastUpdated) return null;
  const color =
    tier === "fresh" ? "bg-green-500"
      : tier === "stale" ? "bg-amber-500"
        : "bg-red-500";
  return (
    <span
      aria-label={`Updated ${ageLabel(lastUpdated)}`}
      title={`Updated ${ageLabel(lastUpdated)}`}
      className={`inline-block size-2 shrink-0 rounded-full ${color}`}
    />
  );
}
