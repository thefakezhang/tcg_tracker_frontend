// "3 hours ago" for a timestamp, in the viewer's language. Intl.RelativeTimeFormat
// with numeric "auto" also says "yesterday" or "now" where the language has a
// word for it, which reads better on a badge than "1 day ago".

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/** The elapsed time from `value` to `now` in the largest whole unit, or null when `value` is unreadable. */
export function relativeTime(value: string, now: number, locale: string): string | null {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  const elapsed = now - parsed;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(elapsed) >= ms) return format.format(-Math.round(elapsed / ms), unit);
  }
  return format.format(0, "second");
}
