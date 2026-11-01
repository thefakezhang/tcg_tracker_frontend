// Shared shape of the Mercari leads read: the request the route accepts, the
// columns the tab needs from the backend view mercari_leads_v (migrations
// 000616 and 000617), and the keyset cursor over each sort. Kept out of
// route.ts because a Next.js route module may export only HTTP handlers.

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

// Mercari C2C ids are "m" plus 9 to 11 digits; Mercari Shops product ids are
// 20 to 32 alphanumerics (the CHECK on jp_mercari_published_leads). The id is
// the cursor tie-breaker and is spliced into a PostgREST filter, so nothing
// outside this shape may pass.
export const SAFE_ITEM_ID = /^(m[0-9]{9,11}|[A-Za-z0-9]{20,32})$/;

// RFC 3339 as PostgREST emits it; no commas or parentheses, which would break
// the "or" filter grammar.
const SAFE_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+\-Z]{8,30}$/;

// multiple is numeric(12,3) and never negative (it exists only with a positive
// net value): at most nine integer digits and three decimals.
const SAFE_MULTIPLE = /^[0-9]{1,9}(\.[0-9]{1,3})?$/;

// The cursor spelling of a NULL multiple. Rows without a multiple sort last
// under "Best multiple", so a page can end on one.
export const NULL_MULTIPLE = "null";

export const LEAD_LANES = ["modern_raw", "vintage_raw", "psa", "unpriced"] as const;
export type LeadLane = (typeof LEAD_LANES)[number];

export const LEAD_SORTS = ["multiple", "newest"] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];

export const PHOTO_STATES = ["unchecked", "confirmed", "conflict", "inconclusive", "rejected"] as const;
export type PhotoState = (typeof PHOTO_STATES)[number];

export type LeadCursor = {
  // The last row's sort key: its multiple (a decimal, or null) under "multiple",
  // its first_seen_at under "newest".
  after: string | null;
  after_key: string;
};

export type LeadsRequest = {
  lane: LeadLane;
  sort: LeadSort;
  // null is every photo state except rejected, the default.
  photo: PhotoState | null;
  includeDismissed: boolean;
  // Listings whose source_status is not ON_SALE are hidden unless asked for.
  includeUnavailable: boolean;
  cursor: LeadCursor | null;
  limit: number;
};

export const LEAD_COLUMNS = [
  "external_item_id",
  "source_item_type",
  "canonical_url",
  "sanitized_title",
  "ask_jpy",
  "shipping_payer",
  "buyer_pays_shipping",
  "shipping_added_jpy",
  "seller_condition_id",
  "source_status",
  "source_created_at",
  "first_seen_at",
  "observed_at",
  "listing_age_hours",
  "observed_age_hours",
  "holder_hint",
  "title_psa_grade",
  "card_resolution",
  "regional_name",
  "english_name",
  "set_code",
  "set_name",
  "card_number",
  "misc_info",
  "image_url",
  "lane",
  "value_usd",
  "value_psa_grade",
  "value_basis",
  "value_as_of",
  "value_sample_count",
  "value_window_days",
  "unpriced_reason",
  "landed_ask_usd",
  "selling_cost_usd",
  "net_value_usd",
  "multiple",
  "multiple_withheld_reason",
  "other_listings",
  "photo_check_state",
  "photo_source_card_uid",
  "photo_card_uid",
  "photo_regional_name",
  "photo_english_name",
  "photo_set_code",
  "photo_card_number",
  "photo_image_url",
  "photo_psa_grade",
  "photo_checked_at",
  "latest_lead_action",
  "latest_lead_action_reason",
  "latest_lead_action_at",
  "dismissed",
  "photo_check_requested",
  // Appended to the view by backend 000617: the card is read from the title,
  // so the label carries its edition and finish, the lead names how it was
  // matched and whether the photo check can see that card, and a raw row says
  // whether it is valued Near Mint or as damaged. Selecting them before
  // 000617 is applied is a 400 from PostgREST, so this ships after the apply.
  "edition",
  "foil_treatment",
  "match_tier",
  "title_card_in_photo_scope",
  "value_condition",
  "nm_value_usd",
].join(", ");

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

function flag(params: URLSearchParams, name: string): boolean | string {
  const raw = params.get(name)?.trim() ?? "";
  if (raw === "") return false;
  if (raw === "1" || raw === "true") return true;
  return `${name} must be 1 or true`;
}

function validTimestamp(value: string): boolean {
  return SAFE_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

/** Bounds every parameter before anything reaches the database; an error string is a 400. */
export function parseLeadsRequest(params: URLSearchParams): { ok: true; value: LeadsRequest } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });

  // The lane is required: the tab shows one lane at a time so a raw value and
  // a PSA value are never ranked against each other.
  const lane = params.get("lane")?.trim() ?? "";
  if (!isOneOf(LEAD_LANES, lane)) {
    return fail("lane is required and must be modern_raw, vintage_raw, psa or unpriced");
  }
  const sort = params.get("sort")?.trim() || "multiple";
  if (!isOneOf(LEAD_SORTS, sort)) return fail("sort must be multiple or newest");
  const photo = params.get("photo")?.trim() ?? "";
  if (photo !== "" && !isOneOf(PHOTO_STATES, photo)) {
    return fail("photo must be unchecked, confirmed, conflict, inconclusive or rejected");
  }
  const includeDismissed = flag(params, "include_dismissed");
  if (typeof includeDismissed === "string") return fail(includeDismissed);
  const includeUnavailable = flag(params, "include_unavailable");
  if (typeof includeUnavailable === "string") return fail(includeUnavailable);

  const after = params.get("after")?.trim() ?? "";
  const afterKey = params.get("after_key")?.trim() ?? "";
  if (Boolean(after) !== Boolean(afterKey)) return fail("after and after_key must be provided together");
  if (afterKey && !SAFE_ITEM_ID.test(afterKey)) return fail("after_key is invalid");
  let cursor: LeadCursor | null = null;
  if (afterKey) {
    if (sort === "newest") {
      if (!validTimestamp(after)) return fail("after must be an RFC 3339 timestamp when sorting by newest");
      cursor = { after, after_key: afterKey };
    } else {
      if (after !== NULL_MULTIPLE && !SAFE_MULTIPLE.test(after)) {
        return fail("after must be a multiple or null when sorting by multiple");
      }
      cursor = { after: after === NULL_MULTIPLE ? null : after, after_key: afterKey };
    }
  }

  const rawLimit = params.get("limit")?.trim() || String(DEFAULT_LIMIT);
  if (!/^\d{1,3}$/.test(rawLimit)) return fail(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  const limit = Number(rawLimit);
  if (limit < 1 || limit > MAX_LIMIT) return fail(`limit must be an integer between 1 and ${MAX_LIMIT}`);

  return {
    ok: true,
    value: { lane, sort, photo: photo === "" ? null : photo, includeDismissed, includeUnavailable, cursor, limit },
  };
}

function multipleText(value: unknown): string | null {
  if (value === null) return null;
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== "string" || !SAFE_MULTIPLE.test(text)) {
    throw new Error("Mercari leads view returned an invalid cursor boundary");
  }
  return text;
}

/** The cursor after the last row of a full page, or null when the page is the last one. */
export function nextCursor(rows: unknown[], limit: number, sort: LeadSort): LeadCursor | null {
  if (rows.length < limit) return null;
  const last = rows.at(-1);
  if (last == null || typeof last !== "object" || Array.isArray(last)) {
    throw new Error("Mercari leads view returned an invalid row");
  }
  const row = last as Record<string, unknown>;
  if (typeof row.external_item_id !== "string" || !SAFE_ITEM_ID.test(row.external_item_id)) {
    throw new Error("Mercari leads view returned an invalid cursor boundary");
  }
  if (sort === "newest") {
    if (typeof row.first_seen_at !== "string" || !validTimestamp(row.first_seen_at)) {
      throw new Error("Mercari leads view returned an invalid cursor boundary");
    }
    return { after: row.first_seen_at, after_key: row.external_item_id };
  }
  if (!("multiple" in row)) throw new Error("Mercari leads view returned an invalid cursor boundary");
  return { after: multipleText(row.multiple), after_key: row.external_item_id };
}
