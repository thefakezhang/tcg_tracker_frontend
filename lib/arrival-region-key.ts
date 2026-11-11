// The Arrivals region key: the backend's name for a region of shops
// ("akihabara", "fukuoka", ...), the same in the focus status, the account
// summary rows, the post rows and the `?region=` filter. The backend refuses a
// malformed one (SQLSTATE 22023), so every place that sends or links a key
// checks it against this one pattern first: the API routes, the dashboard's
// parsers and the leaf URL param. This module has no imports so the URL
// helpers can use it without pulling anything else in.

export const REGION_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** The key when `value` is a well-formed region key (surrounding blanks trimmed), else null. */
export function parseRegionKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return REGION_RE.test(trimmed) ? trimmed : null;
}
