// The Arrivals region key: the backend's name for a region of shops
// ("akihabara", "fukuoka", ...), the same in the focus status, the account
// summary rows, the post rows and the `?region=` filter. The backend refuses a
// malformed one (SQLSTATE 22023), so every place that sends or links a key
// checks it against this one pattern first: the API routes, the dashboard's
// parsers and the leaf URL param. This module has no imports so the URL
// helpers can use it without pulling anything else in.

export const REGION_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** The most region keys one posts request may filter by; the backend refuses more (22023). */
export const MAX_REGION_KEYS = 50;

/** The key when `value` is a well-formed region key (surrounding blanks trimmed), else null. */
export function parseRegionKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return REGION_RE.test(trimmed) ? trimmed : null;
}

/**
 * The region keys in a comma-separated list, leniently: blanks and malformed
 * entries are dropped, duplicates removed, and the rest sorted, capped at
 * `MAX_REGION_KEYS`. One key with no comma is a list of one, so a link from
 * before the filter took several regions still reads.
 */
export function parseRegionKeyList(value: string | null | undefined): string[] {
  const keys = new Set<string>();
  for (const part of (value ?? "").split(",")) {
    const key = parseRegionKey(part);
    if (key !== null) keys.add(key);
  }
  return [...keys].sort().slice(0, MAX_REGION_KEYS);
}
