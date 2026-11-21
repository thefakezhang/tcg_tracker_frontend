"use client";

// A median alone cannot say whether the comps agreed. Twelve sales clustered
// $120-$180 and three scattered $20-$1,700 render as the same number, and the
// second is the one worth hesitating over. This draws where the median sits
// inside P25-P75 so the difference is visible without reading any figures: a
// wide bar is a noisy card, a tight one is a clean read.
//
// The price need not be a median. Surugaya's sell row is the cheapest of every
// store's offer and its band is the spread of all of them, so the price sits at
// or below P25. The scale therefore runs from the lower of the price and P25
// to the higher of the price and P75: a price inside its band draws exactly as
// before, and an outlier low sits visibly left of a band that starts further
// in, instead of pinned to the band's own edge.
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

// Where the band and the marker sit on a scale wide enough to hold both, in
// percent of the bar, plus the scale's two ends for the labels under it.
export interface SpreadGeometry {
  lo: number;
  hi: number;
  bandLeft: number;
  bandWidth: number;
  marker: number;
}

export function spreadGeometry(s: CompSpread): SpreadGeometry {
  const lo = Math.min(s.median, s.p25);
  const hi = Math.max(s.median, s.p75);
  const scale = hi - lo;
  // Every comp at one price and the price on it: nothing to scale, so the
  // band fills the bar and the marker pins to the centre, as it always has.
  if (scale <= 0) return { lo, hi, bandLeft: 0, bandWidth: 100, marker: 50 };
  const at = (n: number) => ((n - lo) / scale) * 100;
  return {
    lo,
    hi,
    bandLeft: at(s.p25),
    bandWidth: at(s.p75) - at(s.p25),
    marker: at(s.median),
  };
}

// A price this far under P25 is an outlier low, not the going price.
export const BELOW_BAND_OUTLIER = 0.2;

// How far the price sits under its own band, in whole percent of P25, when it
// is an outlier low; null when it is inside the band, above it, or close to it.
// On the 2026-11-21 Surugaya pages マーレイン's cheapest offer, ¥260 against a
// band of ¥390-¥573, is 33% below; ココドラ's ¥100 against ¥115-¥145 is not.
export function belowBandPercent(s: CompSpread): number | null {
  if (!(s.p25 > 0) || s.median >= s.p25) return null;
  const gap = (s.p25 - s.median) / s.p25;
  return gap >= BELOW_BAND_OUTLIER ? Math.round(gap * 100) : null;
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
  const g = spreadGeometry(spread);
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
        aria-label={`Spread ${format(p25)} to ${format(p75)}, this price ${format(median)}`}
        title={`P25 ${format(p25)} · this price ${format(median)} · P75 ${format(p75)}`}
      >
        {/* A zero-width band outside the price still shows as a sliver. */}
        <div
          className={`absolute inset-y-0 rounded-full ${tone}`}
          style={{ left: `${g.bandLeft}%`, width: `max(${g.bandWidth}%, 2px)` }}
        />
        <div
          className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
          style={{ left: `${g.marker}%` }}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>{format(g.lo)}</span>
        <span>{format(g.hi)}</span>
      </div>
    </div>
  );
}
