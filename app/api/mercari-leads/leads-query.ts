// Shared shape of the Mercari leads read: the request the route accepts, the
// columns the tab needs from the backend view mercari_leads_v (migrations
// 000616, 000617, 000623, 000633, 000634, 000638 and 000646), the grouped
// feed's arguments (mercari_lead_groups, 000638 and 000646), and the keyset
// cursor over each sort. Kept out of route.ts because a Next.js route module may export only
// HTTP handlers.

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

// The row lanes, and the slab plays (backend 000646, #2707): every raw lane's
// leads whose card's Card Ladder PSA 1-6 floor clears the ask after grading.
// "slab_play" is a feed, never a row's lane.
export const LEAD_LANES = ["modern_raw", "vintage_raw", "psa", "unpriced", "slab_play"] as const;
export type LeadLane = (typeof LEAD_LANES)[number];

export const LEAD_SORTS = ["multiple", "newest", "ending", "condition", "profit"] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];

// The condition the seller chose, 1 (new, unused) to 6 (poor overall).
export const SELLER_CONDITIONS = ["1", "2", "3", "4", "5", "6"] as const;
export type SellerCondition = (typeof SELLER_CONDITIONS)[number];

// How a lead sells (backend 000633). One format per request: an auction has no
// multiple, so the two are never ranked against each other.
export const LEAD_FORMATS = ["fixed_price", "auction"] as const;
export type LeadFormat = (typeof LEAD_FORMATS)[number];

// The sorts each feed offers, its default first: an auction is ranked by its
// soonest stated end, never by a multiple on a bid that rises, and the slab
// plays by their profit after grading. Slab plays are fixed price only.
export function leadSorts(lane: LeadLane, format: LeadFormat): readonly LeadSort[] {
  if (format === "auction") return ["ending", "newest"];
  if (lane === "slab_play") return ["profit", "condition", "newest"];
  return ["multiple", "condition", "newest"];
}

// The cursor spelling of an auction whose end no lead scan read; they sort
// after every auction with a stated end.
export const NULL_ENDS_AT = "null";

export const PHOTO_STATES = ["unchecked", "confirmed", "conflict", "inconclusive", "rejected"] as const;
export type PhotoState = (typeof PHOTO_STATES)[number];

export type LeadCursor = {
  // The last row's sort key: its multiple (a decimal, or null) under "multiple",
  // its first_seen_at under "newest", its auction_ends_at (or null) under
  // "ending", where after_seen is its first_seen_at, the second key; its slab
  // profit under "profit"; and under "condition" the lane's value (the
  // multiple or null, or the slab profit in the slab plays) after its
  // condition, after_condition.
  after: string | null;
  after_key: string;
  after_seen?: string;
  after_condition?: SellerCondition;
};

export type LeadsRequest = {
  lane: LeadLane;
  format: LeadFormat;
  sort: LeadSort;
  // null is every photo state except rejected, the default.
  photo: PhotoState | null;
  includeDismissed: boolean;
  // Listings whose source_status is not ON_SALE are hidden unless asked for.
  includeUnavailable: boolean;
  // Hidden by default since backend 000638 (#2517): rows without a multiple
  // (evidence only), unpriced rows the screen says can never clear the bars,
  // and Mercari Shops listings.
  includeEvidence: boolean;
  includeScreened: boolean;
  includeShops: boolean;
  // The seller conditions to show; null is all six.
  conditions: SellerCondition[] | null;
  // The slab plays whose card only a set and name named, on the slab lane only.
  includeUnverified: boolean;
  cursor: LeadCursor | null;
  limit: number;
  // The members of one group to read in full, in this order (the tab expands
  // a group with the ids the grouped feed returned); null reads the feed.
  ids: string[] | null;
};

// At most this many group members are read in one expansion; a page of the
// feed asks the view for at most MAX_LIMIT representatives.
export const MAX_GROUP_IDS = MAX_LIMIT;

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
  "set_release_date",
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
  // The photo-check badges (#2304 L4): where the lead comes from, the fresh
  // lead scan or the cold crawl retired on 2026-11-02 (in the view since
  // 000616), and the band of a fresh lead waiting for its photo check, which
  // backend 000623 appends. Like 000617's columns, selecting it before 000623
  // is applied is a 400, so this ships after the apply.
  "source_kind",
  "photo_check_priority",
  // Auctions (backend 000633, #2436): how the lead sells, an auction's bid
  // count and stated end from its newest auction observation and when that was,
  // the highest bid that still clears the bars, whether the current bid is
  // still at or under it, and whether the stated end has passed. Selecting them
  // before 000633 is applied is a 400, so this ships after the apply.
  "listing_format",
  "auction_bid_count",
  "auction_ends_at",
  "auction_last_seen_at",
  "auction_max_bid_jpy",
  "auction_bid_within_max",
  "auction_ended",
  // Photo checks paused (backend 000634, #2437): the row's publication ran
  // while the acquisition host's photo checks were off, so nothing is queued.
  // Selecting it before 000634 is applied is a 400, so this ships after the
  // apply.
  "photo_checks_paused",
  // A lighter feed (backend 000638, #2517): the card a group is keyed on, how
  // old the value's newest sale is and when the values were computed, and the
  // never-a-deal screen of an unpriced row with its evidence. Selecting them
  // before 000638 is applied is a 400, so this ships after the apply.
  "current_card_uid",
  "value_age_days",
  "value_refreshed_at",
  "screen_result",
  "screen_evidence_usd",
  "screen_evidence_source",
  "screen_evidence_as_of",
  "screen_multiplier",
  // Slab plays (backend 000646, #2707): the card's Card Ladder PSA 1-6 floor,
  // what selling a slab at it and grading cost, the net, the profit over the
  // landed ask, the multiple and whether the card is trusted. Selecting them
  // before 000646 is applied is a 400, so this ships after the apply.
  "slab_floor_usd",
  "slab_floor_median_usd",
  "slab_floor_sales",
  "slab_floor_grades",
  "slab_floor_as_of",
  "slab_grading_cost_usd",
  "slab_grading_days",
  "slab_selling_cost_usd",
  "slab_net_value_usd",
  "slab_play_profit_usd",
  "slab_play_multiple",
  "slab_play_state",
  // Backend 000648 (#2710).
  "kept_for",
  // Backend 000653 (#2755): the PSA service level a slab play is graded at and
  // its turnaround in business days. Selecting them before 000653 is applied
  // is a 400, so this ships after the apply.
  "slab_grading_service_level",
  "slab_grading_business_days_min",
  "slab_grading_business_days_max",
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
    return fail("lane is required and must be modern_raw, vintage_raw, psa, unpriced or slab_play");
  }
  const format = params.get("format")?.trim() || "fixed_price";
  if (!isOneOf(LEAD_FORMATS, format)) return fail("format must be fixed_price or auction");
  if (lane === "slab_play" && format !== "fixed_price") return fail("slab plays are fixed price only");
  const offered = leadSorts(lane, format);
  const sort = params.get("sort")?.trim() || offered[0];
  if (!isOneOf(LEAD_SORTS, sort) || !offered.includes(sort)) {
    return fail(`sort must be ${offered.join(", ")} here`);
  }
  // Conditions: a comma list of distinct 1 to 6; absent is all of them.
  const rawConditions = params.get("conditions")?.trim() ?? "";
  let conditions: SellerCondition[] | null = null;
  if (rawConditions !== "") {
    const listed = rawConditions.split(",");
    if (listed.some((condition) => !isOneOf(SELLER_CONDITIONS, condition)) || new Set(listed).size !== listed.length) {
      return fail("conditions must be distinct values from 1 to 6");
    }
    conditions = listed as SellerCondition[];
  }
  const photo = params.get("photo")?.trim() ?? "";
  if (photo !== "" && !isOneOf(PHOTO_STATES, photo)) {
    return fail("photo must be unchecked, confirmed, conflict, inconclusive or rejected");
  }
  const includeDismissed = flag(params, "include_dismissed");
  if (typeof includeDismissed === "string") return fail(includeDismissed);
  const includeUnavailable = flag(params, "include_unavailable");
  if (typeof includeUnavailable === "string") return fail(includeUnavailable);
  const includeEvidence = flag(params, "include_evidence");
  if (typeof includeEvidence === "string") return fail(includeEvidence);
  const includeScreened = flag(params, "include_screened");
  if (typeof includeScreened === "string") return fail(includeScreened);
  const includeShops = flag(params, "include_shops");
  if (typeof includeShops === "string") return fail(includeShops);
  const includeUnverified = flag(params, "include_unverified");
  if (typeof includeUnverified === "string") return fail(includeUnverified);
  if (includeUnverified && lane !== "slab_play") return fail("include_unverified is for slab plays only");

  // A group's members: listing ids only, each spliced into a PostgREST "in"
  // filter, so each must have its exact shape; never with a cursor.
  const rawIds = params.get("ids")?.trim() ?? "";
  let ids: string[] | null = null;
  if (rawIds !== "") {
    ids = rawIds.split(",");
    if (ids.length > MAX_GROUP_IDS || ids.some((id) => !SAFE_ITEM_ID.test(id)) || new Set(ids).size !== ids.length) {
      return fail(`ids must be 1 to ${MAX_GROUP_IDS} distinct listing ids`);
    }
    if (params.has("after") || params.has("after_key") || params.has("after_seen") || params.has("after_condition")) {
      return fail("ids cannot be paged");
    }
  }

  const after = params.get("after")?.trim() ?? "";
  const afterKey = params.get("after_key")?.trim() ?? "";
  const afterSeen = params.get("after_seen")?.trim() ?? "";
  const afterCondition = params.get("after_condition")?.trim() ?? "";
  if (Boolean(after) !== Boolean(afterKey)) return fail("after and after_key must be provided together");
  if (afterKey && !SAFE_ITEM_ID.test(afterKey)) return fail("after_key is invalid");
  if (afterSeen && sort !== "ending") return fail("after_seen is only for sorting by ending");
  if (afterCondition && sort !== "condition") return fail("after_condition is only for sorting by condition");
  let cursor: LeadCursor | null = null;
  if (afterKey) {
    if (sort === "profit") {
      if (!SAFE_MULTIPLE.test(after)) return fail("after must be a profit when sorting by profit");
      cursor = { after, after_key: afterKey };
    } else if (sort === "condition") {
      if (!isOneOf(SELLER_CONDITIONS, afterCondition)) {
        return fail("after_condition must be 1 to 6 when sorting by condition");
      }
      // The slab plays' profit is never null; an ordinary lane's multiple can be.
      const nullable = lane !== "slab_play";
      if (!SAFE_MULTIPLE.test(after) && !(nullable && after === NULL_MULTIPLE)) {
        return fail("after must be the lane's value when sorting by condition");
      }
      cursor = { after: after === NULL_MULTIPLE ? null : after, after_key: afterKey, after_condition: afterCondition };
    } else if (sort === "ending") {
      if (after !== NULL_ENDS_AT && !validTimestamp(after)) {
        return fail("after must be an RFC 3339 timestamp or null when sorting by ending");
      }
      if (!validTimestamp(afterSeen)) return fail("after_seen must be an RFC 3339 timestamp when sorting by ending");
      cursor = { after: after === NULL_ENDS_AT ? null : after, after_key: afterKey, after_seen: afterSeen };
    } else if (sort === "newest") {
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
    value: {
      lane,
      format,
      sort,
      photo: photo === "" ? null : photo,
      includeDismissed,
      includeUnavailable,
      includeEvidence,
      includeScreened,
      includeShops,
      conditions,
      includeUnverified,
      cursor,
      limit,
      ids,
    },
  };
}

/**
 * The arguments of the grouped feed, mercari_lead_groups (backend 000638 and
 * 000646): the same filters the ungrouped read applied, and the cursor as the
 * function's typed boundary. Every value was validated by parseLeadsRequest.
 * The 000646 arguments are sent only when they say something, so the request
 * of a tab that uses none of them reads as it did before.
 */
export function groupArgs(request: LeadsRequest): Record<string, unknown> {
  const args: Record<string, unknown> = {
    p_lane: request.lane,
    p_format: request.format,
    p_sort: request.sort,
    p_photo: request.photo,
    p_include_unavailable: request.includeUnavailable,
    p_include_dismissed: request.includeDismissed,
    p_include_evidence: request.includeEvidence,
    p_include_screened: request.includeScreened,
    p_include_shops: request.includeShops,
    p_limit: request.limit,
  };
  if (request.conditions) args.p_conditions = request.conditions;
  if (request.includeUnverified) args.p_include_unverified = true;
  const cursor = request.cursor;
  if (cursor) {
    args.p_after_key = cursor.after_key;
    if (request.sort === "profit") {
      args.p_after_profit = cursor.after;
    } else if (request.sort === "condition") {
      args.p_after_condition = cursor.after_condition;
      if (request.lane === "slab_play") args.p_after_profit = cursor.after;
      else if (cursor.after === null) args.p_after_null = true;
      else args.p_after_multiple = cursor.after;
    } else if (request.sort === "multiple") {
      if (cursor.after === null) args.p_after_null = true;
      else args.p_after_multiple = cursor.after;
    } else if (request.sort === "newest") {
      args.p_after_time = cursor.after;
    } else {
      if (cursor.after === null) args.p_after_null = true;
      else args.p_after_time = cursor.after;
      args.p_after_seen = cursor.after_seen;
    }
  }
  return args;
}

// The group a representative stands for, as mercari_lead_groups returns it.
export type LeadGroup = {
  external_item_id: string;
  group_rows: number;
  group_listings: number;
  group_ask_min_jpy: number;
  group_ask_max_jpy: number;
  group_member_ids: string[];
  multiple: unknown;
  first_seen_at: unknown;
  auction_ends_at: unknown;
  seller_condition_id: unknown;
  slab_play_profit_usd: unknown;
};

function positiveInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("Mercari lead groups returned an invalid count");
  return parsed;
}

/** Holds the grouped feed's rows to their shape; a broken row fails the page. */
export function parseLeadGroups(value: unknown): LeadGroup[] {
  if (!Array.isArray(value)) throw new Error("Mercari lead groups returned an invalid response");
  return value.map((raw) => {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Mercari lead groups returned an invalid row");
    }
    const row = raw as Record<string, unknown>;
    const id = row.external_item_id;
    const members = row.group_member_ids;
    if (typeof id !== "string" || !SAFE_ITEM_ID.test(id) || !Array.isArray(members)
      || members.some((member) => typeof member !== "string" || !SAFE_ITEM_ID.test(member))
      || members[0] !== id) {
      throw new Error("Mercari lead groups returned an invalid group");
    }
    const rows = positiveInteger(row.group_rows);
    const listings = positiveInteger(row.group_listings);
    const askMin = positiveInteger(row.group_ask_min_jpy);
    const askMax = positiveInteger(row.group_ask_max_jpy);
    if (members.length !== rows || listings < rows || askMin > askMax) {
      throw new Error("Mercari lead groups returned an inconsistent group");
    }
    return {
      external_item_id: id,
      group_rows: rows,
      group_listings: listings,
      group_ask_min_jpy: askMin,
      group_ask_max_jpy: askMax,
      group_member_ids: members as string[],
      multiple: row.multiple,
      first_seen_at: row.first_seen_at,
      auction_ends_at: row.auction_ends_at,
      seller_condition_id: row.seller_condition_id,
      slab_play_profit_usd: row.slab_play_profit_usd,
    };
  });
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
export function nextCursor(rows: unknown[], limit: number, sort: LeadSort, lane: LeadLane): LeadCursor | null {
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
  if (sort === "ending") {
    const endsAt = row.auction_ends_at;
    if ((endsAt !== null && (typeof endsAt !== "string" || !validTimestamp(endsAt)))
      || typeof row.first_seen_at !== "string" || !validTimestamp(row.first_seen_at)) {
      throw new Error("Mercari leads view returned an invalid cursor boundary");
    }
    return { after: endsAt, after_key: row.external_item_id, after_seen: row.first_seen_at };
  }
  if (sort === "profit" || (sort === "condition" && lane === "slab_play")) {
    const profit = multipleText(row.slab_play_profit_usd ?? null);
    if (profit === null) throw new Error("Mercari leads view returned an invalid cursor boundary");
    if (sort === "profit") return { after: profit, after_key: row.external_item_id };
    return { after: profit, after_key: row.external_item_id, after_condition: conditionText(row.seller_condition_id) };
  }
  if (!("multiple" in row)) throw new Error("Mercari leads view returned an invalid cursor boundary");
  if (sort === "condition") {
    return {
      after: multipleText(row.multiple),
      after_key: row.external_item_id,
      after_condition: conditionText(row.seller_condition_id),
    };
  }
  return { after: multipleText(row.multiple), after_key: row.external_item_id };
}

function conditionText(value: unknown): SellerCondition {
  if (typeof value !== "string" || !isOneOf(SELLER_CONDITIONS, value)) {
    throw new Error("Mercari leads view returned an invalid cursor boundary");
  }
  return value;
}
