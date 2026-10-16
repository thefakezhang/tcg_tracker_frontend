"use client";

// A median alone cannot say whether the comps agreed. Twelve sales clustered
// $120-$180 and three scattered $20-$1,700 render as the same number, and the
// second is the one worth hesitating over. This draws where the median sits
// inside P25-P75 so the difference is visible without reading any figures: a
// wide bar is a noisy card, a tight one is a clean read.
//
// Deliberately not a chart library. It is three divs and an absolutely
// positioned marker, sized by percentage, so it costs nothing in a table cell
// rendered 50 times a page.

export interface CompSpread {
  p25: number;
  p75: number;
  median: number;
}

// Returns null unless all three are present and form a usable band. A caller
// that renders this must therefore handle null, which is the common case for
// every source that publishes one number.
export function toCompSpread(
  median: number | null | undefined,
  p25: number | null | undefined,
  p75: number | null | undefined,
): CompSpread | null {
  if (median == null || p25 == null || p75 == null) return null;
  if (!Number.isFinite(median) || !Number.isFinite(p25) || !Number.isFinite(p75)) return null;
  // p25 > p75 is a write bug, not something to draw upside down. The database
  // CHECK rejects it, so this only catches hand-built fixtures.
  if (p75 < p25) return null;
  return { p25, p75, median };
}

// How wide the band is relative to its own centre. 0 means every comp agreed;
// 1 means the quartiles are a full median apart. Used for the colour ramp and
// available to callers that want to sort by noisiness.
export function spreadRatio(s: CompSpread): number {
  const centre = s.median !== 0 ? Math.abs(s.median) : (s.p25 + s.p75) / 2;
  if (centre === 0) return 0;
  return (s.p75 - s.p25) / centre;
}

export function CompSpreadBar({
  spread,
  format,
  className = "",
}: {
  spread: CompSpread;
  // Caller owns currency and locale; this component never formats money.
  format: (n: number) => string;
  className?: string;
}) {
  const { p25, p75, median } = spread;
  const span = p75 - p25;
  // A zero-width band (every comp at one price) still deserves a marker, so
  // the median pins to the centre rather than dividing by zero.
  const pct = span > 0 ? ((median - p25) / span) * 100 : 50;
  const clamped = Math.min(100, Math.max(0, pct));
  const ratio = spreadRatio(spread);
  // Tight bands read as trustworthy, wide ones as a warning. The thresholds
  // are judgement, not measurement: at 0.5 the quartiles are half a median
  // apart, which is already a card worth looking at twice.
  const tone =
    ratio >= 1 ? "bg-destructive/50" : ratio >= 0.5 ? "bg-amber-500/50" : "bg-emerald-500/40";

  return (
    <div className={`min-w-24 ${className}`}>
      <div
        className="relative h-1.5 w-full rounded-full bg-muted"
        role="img"
        aria-label={`Comp spread ${format(p25)} to ${format(p75)}, median ${format(median)}`}
        title={`P25 ${format(p25)} · median ${format(median)} · P75 ${format(p75)}`}
      >
        <div className={`absolute inset-y-0 left-0 w-full rounded-full ${tone}`} />
        <div
          className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
          style={{ left: `${clamped}%` }}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>{format(p25)}</span>
        <span>{format(p75)}</span>
      </div>
    </div>
  );
}
