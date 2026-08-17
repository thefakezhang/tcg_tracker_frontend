// Shared date rendering, so user-facing dates look the same everywhere and
// follow the app language (the language toggle, not the browser locale).
//
// Two shapes exist on purpose:
// - formatDate: "Aug 16, 2026" (en) / "2026年8月16日" (ja). Month names, so the
//   day/month order can never be misread across a JP-US business.
// - formatDateTime: the same date plus a short local time, for ops surfaces
//   (source runs, health, calibration) where the hour matters.
//
// DATE columns arrive as "YYYY-MM-DD" strings. `new Date("2026-08-16")` parses
// as UTC midnight, which renders as the previous day in the Americas, so a
// bare date string is pinned to local midnight before formatting.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = typeof value === "string" && DATE_ONLY.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: string | number | Date | null | undefined, language: string): string {
  const d = toDate(value);
  return d ? d.toLocaleDateString(language, { year: "numeric", month: "short", day: "numeric" }) : "";
}

export function formatDateTime(value: string | number | Date | null | undefined, language: string): string {
  const d = toDate(value);
  return d
    ? d.toLocaleString(language, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
}
