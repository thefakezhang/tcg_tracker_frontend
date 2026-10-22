// Shared shape of the Mercari deals read: the columns the tab needs from the
// backend view mercari_deals_v and the composite cursor over them. Kept out of
// route.ts because a Next.js route module may export only HTTP handlers.

export const MAX_LIMIT = 100;

// Mercari C2C ids are "m" plus 9 to 11 digits; Mercari Shops product ids are
// 20 to 32 alphanumerics. The id is the cursor tie-breaker and is spliced into
// a PostgREST filter, so nothing outside this shape may pass.
export const SAFE_ITEM_ID = /^(m[0-9]{9,11}|[A-Za-z0-9]{20,32})$/;

export const DEAL_COLUMNS = [
  "external_item_id",
  "source_item_type",
  "canonical_url",
  "source_search_url",
  "evidence_lane",
  "confidence_tier",
  "reason_codes",
  "sanitized_title",
  "current_card_uid",
  "regional_name",
  "english_name",
  "set_code",
  "card_number",
  "misc_info",
  "image_url",
  "holder_kind",
  "psa_grade",
  "condition_display_name",
  "seller_condition_id",
  "ask_jpy",
  "observed_at",
  "freshness_status",
  "freshness_age_hours",
  "jpy_to_usd_rate",
  "conservative_exit_jpy",
  "conservative_exit_basis",
  "economics_status",
  "net_profit_usd",
  "roi",
  "latest_item_action",
  "latest_item_action_reason",
  "latest_item_action_at",
].join(", ");

export function nextCursor(rows: unknown[], limit: number) {
  if (rows.length < limit) return null;
  const last = rows.at(-1);
  if (last == null || typeof last !== "object" || Array.isArray(last)) {
    throw new Error("Mercari deals view returned an invalid row");
  }
  const row = last as Record<string, unknown>;
  if (typeof row.observed_at !== "string" || Number.isNaN(Date.parse(row.observed_at))
    || typeof row.external_item_id !== "string" || !SAFE_ITEM_ID.test(row.external_item_id)) {
    throw new Error("Mercari deals view returned an invalid cursor boundary");
  }
  return { before: row.observed_at, before_key: row.external_item_id };
}
