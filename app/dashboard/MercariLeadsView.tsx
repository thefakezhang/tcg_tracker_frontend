"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Clock, EyeOff, ExternalLink, Gavel, Info, LoaderCircle, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/dates";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { formatJpy, formatUsd } from "@/lib/money";
import { pokemonVariantLabel } from "@/lib/pokemon-variant";
import {
  LoadFailure,
  SELLER_CONDITION_KEYS,
  previewURL,
  type MercariSellerConditionID,
} from "./MercariDealsView";
import {
  DEFAULT_MERCARI_FORMAT,
  DEFAULT_MERCARI_LANE,
  DEFAULT_MERCARI_SORT,
  MERCARI_FORMAT_PARAM,
  MERCARI_LANE_PARAM,
  MERCARI_LEAD_FORMATS,
  MERCARI_LEAD_LANES,
  MERCARI_SORT_PARAM,
  parseMercariFormatParam,
  parseMercariLaneParam,
  parseMercariSortParam,
  readUrlParam,
  writeUrlParam,
  type MercariLeadFormat,
  type MercariLeadLane,
  type MercariLeadSort,
} from "./url-params";

export type { MercariLeadFormat, MercariLeadLane, MercariLeadSort } from "./url-params";
export type MercariPhotoState = "unchecked" | "confirmed" | "conflict" | "inconclusive" | "rejected";
export type MercariLeadAction = "dismissed" | "photo_check_requested";
export type MercariSourceStatus = "ON_SALE" | "TRADING" | "SOLD_OUT" | "UNKNOWN";
export type MercariWithheldReason = "seller_condition_3_6" | "psa_grade_unread" | "psa_thin_comps";
// How a raw row is valued: Near Mint, or, for a vintage card the seller rates
// 3-6, as damaged at P25 of the same raw sales (backend 000617).
export type MercariValueCondition = "nm" | "damaged_p25";
// Where a lead comes from: the fresh lead scan, or the cold crawl, whose rows
// were retired on 2026-11-02 (backend 000620).
export type MercariLeadSourceKind = "cold_crawl" | "lead_scan";
// The band of a fresh lead waiting for its photo check (backend 000623): 1 the
// operator asked, 2 a lead with a multiple (queued by profit), 3 a PSA lead
// without one.
export type MercariPhotoCheckPriority = 1 | 2 | 3;

// One row of the backend view mercari_leads_v (migrations 000616, 000617 and 000623),
// restricted to the columns the feed shows. The parser below holds every row
// to the lane rules the table's CHECKs enforce, so a row that breaks one fails
// closed instead of rendering a value it should not carry.
export type MercariLead = {
  external_item_id: string;
  source_item_type: "mercari" | "beyond";
  canonical_url: string;
  sanitized_title: string;
  ask_jpy: number;
  shipping_payer: "seller" | "buyer" | "unknown";
  buyer_pays_shipping: boolean;
  shipping_added_jpy: number;
  seller_condition_id: MercariSellerConditionID;
  source_status: MercariSourceStatus;
  source_created_at: string | null;
  first_seen_at: string;
  observed_at: string;
  listing_age_hours: number;
  observed_age_hours: number;
  // "holder_unknown", "psa_unknown", or "psa_<grade>".
  holder_hint: string;
  title_psa_grade: number | null;
  card_resolution: "uid" | "identity" | "unresolved";
  regional_name: string;
  english_name: string | null;
  set_code: string;
  set_name: string | null;
  card_number: string | null;
  misc_info: string | null;
  // The typed variant axes, so a first edition or a mirror shows on the label.
  edition: string | null;
  foil_treatment: string | null;
  image_url: string | null;
  // The shared matcher tier that read the card from the title.
  match_tier: string;
  source_kind: MercariLeadSourceKind;
  // Whether a photo check can compare this listing with the title's card; when
  // it cannot, no photo result can confirm the lead. On a lead_scan row it is
  // false only when the title's card has no reference image; on a cold_crawl
  // row it means the recognition frontier did not include the title's card.
  title_card_in_photo_scope: boolean;
  lane: MercariLeadLane;
  value_usd: number | null;
  value_condition: MercariValueCondition | null;
  nm_value_usd: number | null;
  value_psa_grade: number | null;
  value_basis: string;
  value_as_of: string | null;
  value_sample_count: number;
  value_window_days: number | null;
  unpriced_reason: string | null;
  landed_ask_usd: number;
  selling_cost_usd: number | null;
  net_value_usd: number | null;
  multiple: number | null;
  multiple_withheld_reason: MercariWithheldReason | null;
  other_listings: number;
  photo_check_state: MercariPhotoState;
  // Set only on an unchecked lead_scan row whose title card a check can see.
  photo_check_priority: MercariPhotoCheckPriority | null;
  photo_source_card_uid: string | null;
  photo_card_uid: string | null;
  photo_regional_name: string | null;
  photo_english_name: string | null;
  photo_set_code: string | null;
  photo_card_number: string | null;
  photo_image_url: string | null;
  photo_psa_grade: number | null;
  photo_checked_at: string | null;
  latest_lead_action: MercariLeadAction | null;
  latest_lead_action_reason: string | null;
  latest_lead_action_at: string | null;
  dismissed: boolean;
  photo_check_requested: boolean;
  // The row's publication ran while photo checks were paused on the
  // acquisition host (backend 000634, #2437): nothing is queued, and a request
  // waits until checks resume.
  photo_checks_paused: boolean;
  // How the lead sells (backend 000633, #2436). An auction's ask_jpy is its
  // current bid and it never carries a multiple; its bid count and stated end
  // come from the newest lead scan that marked it as an auction
  // (auction_last_seen_at), and are null when that scan did not read them.
  // auction_max_bid_jpy is the highest bid that still clears 1.0x and $10 of
  // profit, on a priced auction only.
  listing_format: MercariLeadFormat;
  auction_bid_count: number | null;
  auction_ends_at: string | null;
  auction_last_seen_at: string | null;
  auction_max_bid_jpy: number | null;
  auction_bid_within_max: boolean | null;
  auction_ended: boolean;
};

export type MercariLeadFilters = {
  lane: MercariLeadLane;
  format: MercariLeadFormat;
  sort: MercariLeadSort;
  // "" is every photo state except rejected.
  photo: "" | MercariPhotoState;
  includeDismissed: boolean;
  includeUnavailable: boolean;
};

export type MercariLeadCursor = {
  after: string | null;
  after_key: string;
  // The second key of the auctions' "ending" sort: the last row's first sighting.
  after_seen?: string;
};

export type MercariLeadsPage = {
  leads: MercariLead[];
  nextCursor: MercariLeadCursor | null;
};

export type MercariLeadsLoader = (
  filters: MercariLeadFilters,
  cursor: MercariLeadCursor | null,
) => Promise<MercariLeadsPage>;

export type MercariLeadActor = (
  externalItemId: string,
  action: MercariLeadAction,
  reason: string,
) => Promise<void>;

export const DEFAULT_LEAD_FILTERS: MercariLeadFilters = {
  lane: DEFAULT_MERCARI_LANE,
  format: DEFAULT_MERCARI_FORMAT,
  sort: DEFAULT_MERCARI_SORT,
  photo: "",
  includeDismissed: false,
  includeUnavailable: false,
};

export const PHOTO_STATES: readonly MercariPhotoState[] = ["unchecked", "confirmed", "conflict", "inconclusive", "rejected"];

const PAGE_SIZE = 50;

export class MercariLeadsRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "MercariLeadsRequestError";
    this.status = status;
  }
}

const SAFE_ITEM_ID = /^(m[0-9]{9,11}|[A-Za-z0-9]{20,32})$/;
const HOLDER_HINT = /^(holder_unknown|psa_unknown|psa_(10|[1-9]))$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const SELLER_CONDITIONS = new Set(["1", "2", "3", "4", "5", "6"]);
const SOURCE_STATUSES = new Set(["ON_SALE", "TRADING", "SOLD_OUT", "UNKNOWN"]);
const SHIPPING_PAYERS = new Set(["seller", "buyer", "unknown"]);
const RESOLUTIONS = new Set(["uid", "identity", "unresolved"]);
const WITHHELD_REASONS = new Set(["seller_condition_3_6", "psa_grade_unread", "psa_thin_comps"]);
const VALUE_CONDITIONS = new Set(["nm", "damaged_p25"]);
const SOURCE_KINDS = new Set(["cold_crawl", "lead_scan"]);
const LISTING_FORMATS = new Set<string>(MERCARI_LEAD_FORMATS);

function invalid(what: string, index: number): Error {
  return new Error(`Invalid Mercari lead ${what}: ${index}`);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid Mercari lead field: ${field}`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(`Invalid Mercari lead field: ${field}`);
  return value;
}

// PostgREST serializes bigint and numeric as JSON numbers, but a numeric can
// arrive as a string through some clients; accept both and refuse anything else.
function optionalNumber(value: unknown, field: string): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) throw new Error(`Invalid Mercari lead number: ${field}`);
  return parsed;
}

function requiredNumber(value: unknown, field: string): number {
  const parsed = optionalNumber(value, field);
  if (parsed === null) throw new Error(`Invalid Mercari lead number: ${field}`);
  return parsed;
}

function optionalInteger(value: unknown, field: string): number | null {
  const parsed = optionalNumber(value, field);
  if (parsed !== null && !Number.isInteger(parsed)) throw new Error(`Invalid Mercari lead number: ${field}`);
  return parsed;
}

function requiredInteger(value: unknown, field: string): number {
  const parsed = optionalInteger(value, field);
  if (parsed === null) throw new Error(`Invalid Mercari lead number: ${field}`);
  return parsed;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Invalid Mercari lead field: ${field}`);
  return value;
}

function requiredTimestamp(value: unknown, field: string): string {
  const parsed = requiredString(value, field);
  if (Number.isNaN(Date.parse(parsed))) throw new Error(`Invalid Mercari lead timestamp: ${field}`);
  return parsed;
}

function optionalTimestamp(value: unknown, field: string): string | null {
  if (value == null) return null;
  return requiredTimestamp(value, field);
}

function imageURL(value: unknown, field: string): string | null {
  if (value == null) return null;
  const parsed = requiredString(value, field);
  let url: URL;
  try {
    url = new URL(parsed, "http://fixture.local");
  } catch {
    throw new Error(`Invalid Mercari lead URL: ${field}`);
  }
  if (!["http:", "https:", "data:"].includes(url.protocol)) {
    throw new Error(`Invalid Mercari lead URL scheme: ${field}`);
  }
  return parsed;
}

function oneOf<T extends string>(values: Set<string>, value: unknown, what: string, index: number): T {
  if (typeof value !== "string" || !values.has(value)) throw invalid(what, index);
  return value as T;
}

export function parseMercariLeads(value: unknown): MercariLead[] {
  if (!Array.isArray(value)) throw new Error("Invalid Mercari leads response");
  return value.map((raw, index) => {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      throw invalid("row", index);
    }
    const row = raw as Record<string, unknown>;
    const externalItemId = requiredString(row.external_item_id, "external_item_id");
    if (!SAFE_ITEM_ID.test(externalItemId)) throw invalid("id", index);
    const sourceItemType = oneOf<"mercari" | "beyond">(new Set(["mercari", "beyond"]), row.source_item_type, "source", index);
    // The table CHECKs that the URL is exactly the listing's own page.
    const canonicalURL = requiredString(row.canonical_url, "canonical_url");
    const expectedURL = sourceItemType === "mercari"
      ? `https://jp.mercari.com/item/${externalItemId}`
      : `https://jp.mercari.com/shops/product/${externalItemId}`;
    if (canonicalURL !== expectedURL) throw invalid("URL", index);

    const lane = oneOf<MercariLeadLane>(new Set(MERCARI_LEAD_LANES), row.lane, "lane", index);
    const holderHint = requiredString(row.holder_hint, "holder_hint");
    if (!HOLDER_HINT.test(holderHint)) throw invalid("holder", index);
    const titleGrade = optionalInteger(row.title_psa_grade, "title_psa_grade");
    const hintGrade = holderHint.startsWith("psa_") && holderHint !== "psa_unknown" ? Number(holderHint.slice(4)) : null;
    if (titleGrade !== hintGrade) throw invalid("grade", index);

    const valueUsd = optionalNumber(row.value_usd, "value_usd");
    const valueGrade = optionalInteger(row.value_psa_grade, "value_psa_grade");
    const netValue = optionalNumber(row.net_value_usd, "net_value_usd");
    const multiple = optionalNumber(row.multiple, "multiple");
    const withheld = optionalString(row.multiple_withheld_reason, "multiple_withheld_reason");
    if (withheld !== null && !WITHHELD_REASONS.has(withheld)) throw invalid("withheld reason", index);
    const valueCondition = optionalString(row.value_condition, "value_condition");
    if (valueCondition !== null && !VALUE_CONDITIONS.has(valueCondition)) throw invalid("value condition", index);
    const nmValue = optionalNumber(row.nm_value_usd, "nm_value_usd");
    const unpricedReason = optionalString(row.unpriced_reason, "unpriced_reason");
    const sellerCondition = oneOf<MercariSellerConditionID>(SELLER_CONDITIONS, row.seller_condition_id, "seller condition", index);
    const ratedThreeToSix = sellerCondition !== "1" && sellerCondition !== "2";

    // The value rules. A raw lane carries a raw value; a PSA lane carries a
    // value at exactly the title's grade, or none when the grade is unread; an
    // unpriced row carries none. Anything else would put a raw value on a slab
    // or a neighbouring grade's value on this one, so it never renders.
    if (lane === "modern_raw" || lane === "vintage_raw") {
      if (holderHint !== "holder_unknown" || valueUsd === null || valueGrade !== 0
        || valueCondition === null || nmValue === null
        || (valueCondition === "nm" && nmValue !== valueUsd)
        || (valueCondition === "damaged_p25" && valueUsd > nmValue)) {
        throw invalid("raw value", index);
      }
      // The seller's condition, as the operator set it on 2026-11-01: a card
      // rated 1-2 is valued Near Mint with a multiple; a vintage card rated 3-6
      // is valued as damaged, also with a multiple; a modern card rated 3-6
      // keeps its Near Mint value as evidence, with no multiple.
      const allowed = !ratedThreeToSix
        ? valueCondition === "nm" && withheld === null
        : lane === "vintage_raw"
          ? valueCondition === "damaged_p25" && withheld === null
          : valueCondition === "nm" && withheld === "seller_condition_3_6";
      if (!allowed) throw invalid("seller condition", index);
    } else if (lane === "psa") {
      if (valueCondition !== null || nmValue !== null) throw invalid("PSA value", index);
      if (holderHint === "psa_unknown") {
        if (valueUsd !== null || valueGrade !== null || multiple !== null || withheld !== "psa_grade_unread") {
          throw invalid("PSA value", index);
        }
      } else if (titleGrade === null || valueUsd === null || valueGrade !== titleGrade
        || (withheld !== null && withheld !== "psa_thin_comps")) {
        // A PSA value on fewer than three exact-grade sales is shown as
        // evidence (psa_thin_comps); it is still that grade's value.
        throw invalid("PSA value", index);
      }
    } else if (valueUsd !== null || valueGrade !== null || multiple !== null || withheld !== null
      || valueCondition !== null || nmValue !== null
      || holderHint === "psa_unknown" || unpricedReason === null || unpricedReason.trim() === "") {
      throw invalid("unpriced row", index);
    }
    if (valueUsd !== null && valueUsd <= 0) throw invalid("value", index);
    if ((valueUsd === null) !== (netValue === null)) throw invalid("net value", index);
    if (multiple !== null && (multiple < 0 || netValue === null || netValue <= 0)) throw invalid("multiple", index);
    // How the lead sells, as 000633's CHECKs hold it: a fixed-price row carries
    // no auction fact; an auction row carries no multiple, says when it was
    // last seen as an auction (no later than its newest observation), and has
    // a maximum bid exactly when it is priced, at or above its current bid.
    const format = oneOf<MercariLeadFormat>(LISTING_FORMATS, row.listing_format, "listing format", index);
    const auction = format === "auction";
    const bidCount = optionalInteger(row.auction_bid_count, "auction_bid_count");
    const endsAt = optionalTimestamp(row.auction_ends_at, "auction_ends_at");
    const lastSeenAt = optionalTimestamp(row.auction_last_seen_at, "auction_last_seen_at");
    const maxBid = optionalInteger(row.auction_max_bid_jpy, "auction_max_bid_jpy");
    const withinMax = row.auction_bid_within_max == null ? null : requiredBoolean(row.auction_bid_within_max, "auction_bid_within_max");
    const ended = requiredBoolean(row.auction_ended, "auction_ended");
    if (!auction) {
      if (bidCount !== null || endsAt !== null || lastSeenAt !== null || maxBid !== null || withinMax !== null || ended) {
        throw invalid("fixed-price auction facts", index);
      }
      // A fixed-price lead has a multiple or says why it has none.
      if (lane !== "unpriced" && (multiple === null) !== (withheld !== null)) throw invalid("withheld reason", index);
    }

    const ask = requiredNumber(row.ask_jpy, "ask_jpy");
    if (auction) {
      if (multiple !== null || lastSeenAt === null
        || Date.parse(lastSeenAt) > Date.parse(requiredTimestamp(row.observed_at, "observed_at"))
        || (bidCount !== null && bidCount < 0)
        || (maxBid !== null && maxBid < 1)
        || (valueUsd === null) !== (maxBid === null)
        || (maxBid !== null && ask > maxBid)
        || withinMax !== (maxBid === null ? null : ask <= maxBid)
        || (ended && endsAt === null)) {
        throw invalid("auction", index);
      }
    }

    const valueAsOf = optionalString(row.value_as_of, "value_as_of");
    if ((valueAsOf === null) !== (valueUsd === null) || (valueAsOf !== null && !DATE_ONLY.test(valueAsOf))) {
      throw invalid("value date", index);
    }
    const windowDays = optionalInteger(row.value_window_days, "value_window_days");
    if (windowDays !== null && windowDays !== 60 && windowDays !== 180) throw invalid("value window", index);
    const sampleCount = requiredInteger(row.value_sample_count, "value_sample_count");
    if (sampleCount < 0) throw invalid("sample count", index);

    if (ask <= 0) throw invalid("ask", index);
    const landed = requiredNumber(row.landed_ask_usd, "landed_ask_usd");
    if (landed <= 0) throw invalid("landed ask", index);
    const shippingPayer = oneOf<MercariLead["shipping_payer"]>(SHIPPING_PAYERS, row.shipping_payer, "shipping payer", index);
    const buyerPays = requiredBoolean(row.buyer_pays_shipping, "buyer_pays_shipping");
    if (buyerPays !== (shippingPayer === "buyer")) throw invalid("shipping payer", index);
    const shippingAdded = requiredInteger(row.shipping_added_jpy, "shipping_added_jpy");
    if (shippingAdded < 0 || (!buyerPays && shippingAdded !== 0)) throw invalid("shipping", index);

    const otherListings = requiredInteger(row.other_listings, "other_listings");
    if (otherListings < 0) throw invalid("other listings", index);

    const action = optionalString(row.latest_lead_action, "latest_lead_action");
    if (action !== null && action !== "dismissed" && action !== "photo_check_requested") {
      throw invalid("action", index);
    }

    // The photo-check queue, as 000623's CHECKs hold it: a band is 1 to 3, and
    // only an unchecked lead_scan row whose title card a check can see is
    // queued, so a badge never says a check is on its way when none can come.
    const sourceKind = oneOf<MercariLeadSourceKind>(SOURCE_KINDS, row.source_kind, "source kind", index);
    const photoState = oneOf<MercariPhotoState>(new Set(PHOTO_STATES), row.photo_check_state, "photo state", index);
    const inPhotoScope = requiredBoolean(row.title_card_in_photo_scope, "title_card_in_photo_scope");
    const priority = optionalInteger(row.photo_check_priority, "photo_check_priority");
    // A publication that ran while photo checks were paused queues nothing
    // (000634), so a band beside the pause is a row that breaks the rule.
    const checksPaused = requiredBoolean(row.photo_checks_paused, "photo_checks_paused");
    if (checksPaused && sourceKind !== "lead_scan") throw invalid("photo checks paused", index);
    if (priority !== null && (priority < 1 || priority > 3 || checksPaused
      || sourceKind !== "lead_scan" || photoState !== "unchecked" || !inPhotoScope)) {
      throw invalid("photo check priority", index);
    }

    return {
      external_item_id: externalItemId,
      source_item_type: sourceItemType,
      canonical_url: canonicalURL,
      sanitized_title: requiredString(row.sanitized_title, "sanitized_title"),
      ask_jpy: ask,
      shipping_payer: shippingPayer,
      buyer_pays_shipping: buyerPays,
      shipping_added_jpy: shippingAdded,
      seller_condition_id: sellerCondition,
      source_status: oneOf<MercariSourceStatus>(SOURCE_STATUSES, row.source_status, "source status", index),
      source_created_at: optionalTimestamp(row.source_created_at, "source_created_at"),
      first_seen_at: requiredTimestamp(row.first_seen_at, "first_seen_at"),
      observed_at: requiredTimestamp(row.observed_at, "observed_at"),
      listing_age_hours: requiredNumber(row.listing_age_hours, "listing_age_hours"),
      observed_age_hours: requiredNumber(row.observed_age_hours, "observed_age_hours"),
      holder_hint: holderHint,
      title_psa_grade: titleGrade,
      card_resolution: oneOf<MercariLead["card_resolution"]>(RESOLUTIONS, row.card_resolution, "card resolution", index),
      regional_name: requiredString(row.regional_name, "regional_name"),
      english_name: optionalString(row.english_name, "english_name"),
      set_code: requiredString(row.set_code, "set_code"),
      set_name: optionalString(row.set_name, "set_name"),
      card_number: optionalString(row.card_number, "card_number"),
      misc_info: optionalString(row.misc_info, "misc_info"),
      edition: optionalString(row.edition, "edition"),
      foil_treatment: optionalString(row.foil_treatment, "foil_treatment"),
      image_url: imageURL(row.image_url, "image_url"),
      // A tier the matcher adds later is shown by its code, not refused: it
      // says how the card was read, not what it is worth.
      match_tier: requiredString(row.match_tier, "match_tier"),
      source_kind: sourceKind,
      title_card_in_photo_scope: inPhotoScope,
      lane,
      value_usd: valueUsd,
      value_condition: valueCondition as MercariValueCondition | null,
      nm_value_usd: nmValue,
      value_psa_grade: valueGrade,
      value_basis: requiredString(row.value_basis, "value_basis"),
      value_as_of: valueAsOf,
      value_sample_count: sampleCount,
      value_window_days: windowDays,
      unpriced_reason: unpricedReason,
      landed_ask_usd: landed,
      selling_cost_usd: optionalNumber(row.selling_cost_usd, "selling_cost_usd"),
      net_value_usd: netValue,
      multiple,
      multiple_withheld_reason: withheld as MercariWithheldReason | null,
      other_listings: otherListings,
      photo_check_state: photoState,
      photo_check_priority: priority as MercariPhotoCheckPriority | null,
      photo_source_card_uid: optionalString(row.photo_source_card_uid, "photo_source_card_uid"),
      photo_card_uid: optionalString(row.photo_card_uid, "photo_card_uid"),
      photo_regional_name: optionalString(row.photo_regional_name, "photo_regional_name"),
      photo_english_name: optionalString(row.photo_english_name, "photo_english_name"),
      photo_set_code: optionalString(row.photo_set_code, "photo_set_code"),
      photo_card_number: optionalString(row.photo_card_number, "photo_card_number"),
      photo_image_url: imageURL(row.photo_image_url, "photo_image_url"),
      photo_psa_grade: optionalInteger(row.photo_psa_grade, "photo_psa_grade"),
      photo_checked_at: optionalTimestamp(row.photo_checked_at, "photo_checked_at"),
      latest_lead_action: action,
      latest_lead_action_reason: optionalString(row.latest_lead_action_reason, "latest_lead_action_reason"),
      latest_lead_action_at: optionalTimestamp(row.latest_lead_action_at, "latest_lead_action_at"),
      dismissed: requiredBoolean(row.dismissed, "dismissed"),
      photo_check_requested: requiredBoolean(row.photo_check_requested, "photo_check_requested"),
      photo_checks_paused: checksPaused,
      listing_format: format,
      auction_bid_count: bidCount,
      auction_ends_at: endsAt,
      auction_last_seen_at: lastSeenAt,
      auction_max_bid_jpy: maxBid,
      auction_bid_within_max: withinMax,
      auction_ended: ended,
    };
  });
}

function parseCursor(value: unknown): MercariLeadCursor | null {
  if (value === null) return null;
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Mercari leads cursor");
  }
  const raw = value as Record<string, unknown>;
  const after = optionalString(raw.after, "next_cursor.after");
  const afterKey = requiredString(raw.after_key, "next_cursor.after_key");
  if (!SAFE_ITEM_ID.test(afterKey) || after === "") throw new Error("Invalid Mercari leads cursor");
  if (raw.after_seen == null) return { after, after_key: afterKey };
  return { after, after_key: afterKey, after_seen: requiredTimestamp(raw.after_seen, "next_cursor.after_seen") };
}

async function readBody(response: Response): Promise<unknown> {
  return response.json().catch(() => null) as Promise<unknown>;
}

function errorMessage(body: unknown, status: number): string {
  return body != null && typeof body === "object" && "error" in body && typeof body.error === "string"
    ? body.error
    : `HTTP ${status}`;
}

export const loadMercariLeads: MercariLeadsLoader = async (filters, cursor) => {
  const query = new URLSearchParams({
    lane: filters.lane,
    format: filters.format,
    sort: filters.sort,
    limit: String(PAGE_SIZE),
  });
  if (filters.photo) query.set("photo", filters.photo);
  if (filters.includeDismissed) query.set("include_dismissed", "1");
  if (filters.includeUnavailable) query.set("include_unavailable", "1");
  if (cursor) {
    // A best-multiple page can end inside the rows without a multiple, and an
    // ending-soonest page inside the auctions whose end no scan read.
    query.set("after", cursor.after ?? "null");
    query.set("after_key", cursor.after_key);
    if (cursor.after_seen) query.set("after_seen", cursor.after_seen);
  }
  const response = await fetch(`/api/mercari-leads?${query}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new MercariLeadsRequestError(response.status, errorMessage(body, response.status));
  }
  if (body == null || typeof body !== "object" || !("leads" in body) || !("next_cursor" in body)) {
    throw new Error("Invalid Mercari leads response");
  }
  return {
    leads: parseMercariLeads(body.leads),
    nextCursor: parseCursor(body.next_cursor),
  };
};

export const recordMercariLeadAction: MercariLeadActor = async (externalItemId, action, reason) => {
  const response = await fetch("/api/mercari-leads/action", {
    method: "POST",
    cache: "no-store",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ external_item_id: externalItemId, action, reason }),
  });
  if (!response.ok) {
    const body = await readBody(response);
    throw new MercariLeadsRequestError(response.status, errorMessage(body, response.status));
  }
};

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

// A date or an age reads as one value, so it never breaks across lines.
function unbroken(text: string): string {
  return text.replace(/ /g, "\u00a0");
}

function isUnknown(value: string | null): boolean {
  return value === null || value.trim() === "" || value === "UNKNOWN";
}

/** The sorts each format offers: an auction has no multiple, a fixed-price lead no end. */
export function sortsFor(format: MercariLeadFormat): readonly MercariLeadSort[] {
  return format === "auction" ? ["ending", "newest"] : ["multiple", "newest"];
}

/**
 * The sort a feed actually uses. Unpriced fixed-price leads carry no multiple,
 * so "Best multiple" would only be id order there. An auction is never ranked by
 * a multiple on a bid that rises: its decision is due at its end, so a sort the
 * auctions do not offer reads as ending soonest, and one the fixed-price feed
 * does not offer reads as its default.
 */
export function effectiveSort(filters: MercariLeadFilters): MercariLeadSort {
  const offered = sortsFor(filters.format);
  const sort = offered.includes(filters.sort) ? filters.sort : offered[0];
  return filters.format === "fixed_price" && filters.lane === "unpriced" ? "newest" : sort;
}

const LANE_KEYS: Record<MercariLeadLane, TranslationKey> = {
  modern_raw: "mercariLeads.lane.modern_raw",
  vintage_raw: "mercariLeads.lane.vintage_raw",
  psa: "mercariLeads.lane.psa",
  unpriced: "mercariLeads.lane.unpriced",
};

const LANE_HINT_KEYS: Record<MercariLeadLane, TranslationKey> = {
  modern_raw: "mercariLeads.laneHint.modern_raw",
  vintage_raw: "mercariLeads.laneHint.vintage_raw",
  psa: "mercariLeads.laneHint.psa",
  unpriced: "mercariLeads.laneHint.unpriced",
};

const SORT_KEYS: Record<MercariLeadSort, TranslationKey> = {
  multiple: "mercariLeads.sort.multiple",
  newest: "mercariLeads.sort.newest",
  ending: "mercariLeads.sort.ending",
};

const FORMAT_KEYS: Record<MercariLeadFormat, TranslationKey> = {
  fixed_price: "mercariLeads.format.fixed_price",
  auction: "mercariLeads.format.auction",
};

const PHOTO_KEYS: Record<MercariPhotoState, TranslationKey> = {
  unchecked: "mercariLeads.photo.unchecked",
  confirmed: "mercariLeads.photo.confirmed",
  conflict: "mercariLeads.photo.conflict",
  inconclusive: "mercariLeads.photo.inconclusive",
  rejected: "mercariLeads.photo.rejected",
};

// A fresh lead is judged by the lead photo checker (backend #2480), which
// answers whether the photos show the title's card: they match, they show a
// different card, or it cannot tell. It proves the art, not the printing.
type MercariCheckerState = "confirmed" | "conflict" | "inconclusive";

const CHECKER_KEYS: Record<MercariCheckerState, TranslationKey> = {
  confirmed: "mercariLeads.photo.checker.confirmed",
  conflict: "mercariLeads.photo.checker.conflict",
  inconclusive: "mercariLeads.photo.checker.inconclusive",
};

// An unclear photo is a caution, not a shrug: the operator review of
// 2026-11-08 found the title was right on only 3 of 10 such galleries, so it
// reads orange, a colour no other photo state uses.
const CHECKER_UNCLEAR_CLASS = "border-orange-500/60 bg-orange-500/10 text-orange-800 dark:text-orange-200";

const CHECKER_NOTES: Partial<Record<MercariCheckerState, TranslationKey>> = {
  confirmed: "mercariLeads.photoNote.checkerConfirmed",
  inconclusive: "mercariLeads.photoNote.checkerUnclear",
};

function isCheckerState(state: MercariPhotoState): state is MercariCheckerState {
  return state === "confirmed" || state === "conflict" || state === "inconclusive";
}

// Amber, green, red and grey, as the design fixes them; a rejected lead is
// visible only when asked for and reads as finished, not as a warning.
const PHOTO_CLASSES: Record<MercariPhotoState, string> = {
  unchecked: "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  confirmed: "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  conflict: "border-red-500/50 bg-red-500/10 text-red-800 dark:text-red-200",
  inconclusive: "border-zinc-500/50 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  rejected: "border-zinc-500/50 bg-transparent text-muted-foreground line-through",
};

const STATUS_KEYS: Record<Exclude<MercariSourceStatus, "ON_SALE">, TranslationKey> = {
  TRADING: "mercariLeads.status.TRADING",
  SOLD_OUT: "mercariLeads.status.SOLD_OUT",
  UNKNOWN: "mercariLeads.status.UNKNOWN",
};

const VALUE_BASIS_KEYS: Record<string, TranslationKey> = {
  ebay_rule_v0: "mercariLeads.valueBasis.ebay_rule_v0",
};

// psa_thin_comps names its sale count and grade, so it is worded in LeadCard.
const WITHHELD_KEYS: Record<Exclude<MercariWithheldReason, "psa_thin_comps">, TranslationKey> = {
  seller_condition_3_6: "mercariLeads.withheld.seller_condition_3_6",
  psa_grade_unread: "mercariLeads.withheld.psa_grade_unread",
};

const MATCH_TIER_KEYS: Record<string, TranslationKey> = {
  exact: "mercariLeads.matchTier.exact",
  memory: "mercariLeads.matchTier.memory",
  family_default: "mercariLeads.matchTier.family_default",
  identity: "mercariLeads.matchTier.identity",
  identity_standard: "mercariLeads.matchTier.identity_standard",
  setless_number: "mercariLeads.matchTier.setless_number",
  setless_variant: "mercariLeads.matchTier.setless_variant",
  setless_name: "mercariLeads.matchTier.setless_name",
  sql_family: "mercariLeads.matchTier.sql_family",
  set_name: "mercariLeads.matchTier.set_name",
  name_rarity: "mercariLeads.matchTier.name_rarity",
};

// A fresh lead waiting for its photo check reads blue, not amber: the check is
// on its way, and the band says why it was queued.
const QUEUED_KEYS: Record<MercariPhotoCheckPriority, TranslationKey> = {
  1: "mercariLeads.photo.queued.requested",
  2: "mercariLeads.photo.queued.profit",
  3: "mercariLeads.photo.queued.psa",
};

const QUEUED_CLASS = "border-sky-500/50 bg-sky-500/10 text-sky-800 dark:text-sky-200";

// An auction reads violet, a colour no photo state or age uses, so it is never
// taken for a deal's green; one whose stated end has passed reads as finished.
const AUCTION_CLASS = "border-violet-500/50 bg-violet-500/10 text-violet-800 dark:text-violet-200";
const AUCTION_ENDED_CLASS = "border-zinc-500/50 bg-transparent text-muted-foreground";

const SOURCE_KIND_KEYS: Record<Exclude<MercariLeadSourceKind, "lead_scan">, TranslationKey> = {
  cold_crawl: "mercariLeads.source.cold_crawl",
};

// The band a fresh lead waits in, as the next lead-scan publication (every 30
// minutes) will queue it. A request that publication has not read yet goes
// first, so it reads as band 1 at once; a dismissed lead is never queued, so a
// band from before the dismissal is not shown. Only an unchecked lead_scan row
// whose title card a check can see is ever queued, and nothing is while photo
// checks are paused (#2437): a check is not on its way then, whatever was asked.
function queuedBand(lead: MercariLead): MercariPhotoCheckPriority | null {
  if (lead.source_kind !== "lead_scan" || lead.photo_check_state !== "unchecked"
    || !lead.title_card_in_photo_scope || lead.dismissed || lead.listing_format === "auction"
    || lead.photo_checks_paused) {
    return null;
  }
  return lead.photo_check_requested ? 1 : lead.photo_check_priority;
}

// A request leads to a check only when a check can compare the listing with the
// title's card. A fresh lead is checked once, so it can ask only while it waits
// and is not already first in line; a cold-crawl lead keeps its old rule, where
// a photo that already agrees with the title needs no second check.
function canRequestPhotoCheck(lead: MercariLead): boolean {
  // An auction is never photo-checked (backend #2436), so a request would wait
  // for a check that cannot come.
  if (!lead.title_card_in_photo_scope || lead.listing_format === "auction") return false;
  // While photo checks are paused no check comes, so the button is not offered;
  // the badge says the checks are paused instead (#2437).
  if (lead.photo_checks_paused) return false;
  if (lead.source_kind === "lead_scan") {
    return lead.photo_check_state === "unchecked" && queuedBand(lead) !== 1;
  }
  return !lead.photo_check_requested && lead.photo_check_state !== "confirmed";
}

// The photo-check badge and the note beneath it. When no check can compare the
// listing with the title's card, an unchecked lead must not read as one waiting
// for its check: on a fresh lead the card has no reference image, and on a
// cold-crawl lead the recognition frontier did not include the card.
function photoStatus(lead: MercariLead): { key: TranslationKey; className: string; note: TranslationKey | null } {
  const state = lead.photo_check_state;
  const scopeNote: TranslationKey | null = lead.title_card_in_photo_scope || state === "rejected"
    ? null
    : lead.source_kind === "lead_scan"
      ? "mercariLeads.photoNote.noReferenceImage"
      : "mercariLeads.photoNote.frontier";
  if (lead.source_kind === "lead_scan" && isCheckerState(state)) {
    return {
      key: CHECKER_KEYS[state],
      className: state === "inconclusive" ? CHECKER_UNCLEAR_CLASS : PHOTO_CLASSES[state],
      note: scopeNote ?? CHECKER_NOTES[state] ?? null,
    };
  }
  if (state !== "unchecked") {
    return { key: PHOTO_KEYS[state], className: PHOTO_CLASSES[state], note: scopeNote };
  }
  if (!lead.title_card_in_photo_scope) {
    return { key: "mercariLeads.photo.outOfScope", className: PHOTO_CLASSES.inconclusive, note: scopeNote };
  }
  // Paused checks read grey, as no check is coming, never amber or blue; a
  // request made before the pause is kept and goes first when they resume.
  if (lead.photo_checks_paused && lead.listing_format !== "auction") {
    return {
      key: "mercariLeads.photo.paused",
      className: PHOTO_CLASSES.inconclusive,
      note: lead.photo_check_requested ? "mercariLeads.photoNote.pausedRequested" : "mercariLeads.photoNote.paused",
    };
  }
  const band = queuedBand(lead);
  if (band !== null) return { key: QUEUED_KEYS[band], className: QUEUED_CLASS, note: null };
  return {
    key: PHOTO_KEYS.unchecked,
    // Amber means a check may still come; none comes for an auction.
    className: lead.listing_format === "auction" ? PHOTO_CLASSES.inconclusive : PHOTO_CLASSES.unchecked,
    note: lead.listing_format === "auction"
      ? "mercariLeads.photoNote.auction"
      : lead.source_kind === "lead_scan" ? "mercariLeads.photoNote.notQueued" : null,
  };
}

// The view computes every age at read time (observed_age_hours is now() less
// observed_at), so an age derived from it agrees with the others on the card
// and does not depend on the viewer's clock.
function hoursAtRead(lead: MercariLead, timestamp: string): number {
  return Math.max(0, lead.observed_age_hours + (Date.parse(lead.observed_at) - Date.parse(timestamp)) / 3_600_000);
}

// Hours from the read until a later time, such as an auction's stated end, on
// the same clock; negative once it has passed.
function hoursUntilAtRead(lead: MercariLead, timestamp: string): number {
  return (Date.parse(timestamp) - Date.parse(lead.observed_at)) / 3_600_000 - lead.observed_age_hours;
}

const UNPRICED_KEYS: Record<string, TranslationKey> = {
  no_raw_comps_180d: "mercariLeads.unpricedReason.no_raw_comps_180d",
  thin_raw_comps_180d: "mercariLeads.unpricedReason.thin_raw_comps_180d",
  no_psa_comps_at_grade_180d: "mercariLeads.unpricedReason.no_psa_comps_at_grade_180d",
  card_unresolved: "mercariLeads.unpricedReason.card_unresolved",
};

// The listing's age decides whether a lead is still worth opening, because
// Mercari listings sell within days. Fresh under a day, aging under three, old
// after that.
function ageClass(hours: number): string {
  if (hours < 24) return "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200";
  if (hours < 72) return "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200";
  return "border-red-500/50 bg-red-500/10 text-red-800 dark:text-red-200";
}

function LeadActions({
  lead,
  actor,
  onActed,
}: {
  lead: MercariLead;
  actor: MercariLeadActor;
  onActed: (action: MercariLeadAction, reason: string) => void;
}) {
  const { t } = useTranslation();
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<MercariLeadAction | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const act = async (action: MercariLeadAction, actionReason: string) => {
    setPending(action);
    setError(null);
    try {
      await actor(lead.external_item_id, action, actionReason);
      onActed(action, actionReason);
      setDismissing(false);
      setReason("");
    } catch (reasonForFailure) {
      setError(asError(reasonForFailure));
    } finally {
      setPending(null);
    }
  };

  const reasonId = `mercari-lead-dismiss-reason-${lead.external_item_id}`;
  const canRequestPhoto = canRequestPhotoCheck(lead);
  return (
    <div className="space-y-2">
      {dismissing ? (
        <form
          className="flex min-w-0 flex-col gap-2 rounded-lg border p-2 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = reason.trim();
            if (trimmed) void act("dismissed", trimmed);
          }}
        >
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor={reasonId}>{t("mercari.dismissReason")}</Label>
            <Input
              id={reasonId}
              className="h-11 sm:h-8"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t("mercariLeads.dismissReasonPlaceholder")}
              maxLength={500}
              autoComplete="off"
            />
          </div>
          <Button type="submit" className="h-11 sm:h-8" variant="destructive" disabled={pending !== null || reason.trim() === ""}>
            {pending === "dismissed" ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <EyeOff className="size-4" aria-hidden="true" />}
            {t("mercari.confirmDismiss")}
          </Button>
          <Button type="button" className="h-11 sm:h-8" variant="outline" disabled={pending !== null} onClick={() => { setDismissing(false); setReason(""); setError(null); }}>
            {t("mercari.cancel")}
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {!lead.dismissed && (
            <Button type="button" className="h-11 sm:h-8" variant="outline" onClick={() => setDismissing(true)}>
              <EyeOff className="size-4" aria-hidden="true" />
              {t("mercari.dismiss")}
            </Button>
          )}
          {canRequestPhoto && (
            <Button type="button" className="h-11 sm:h-8" variant="outline" disabled={pending !== null} onClick={() => void act("photo_check_requested", "")}>
              {pending === "photo_check_requested" ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Camera className="size-4" aria-hidden="true" />}
              {t("mercariLeads.requestPhotoCheck")}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p className="break-words text-xs text-destructive" role="alert">
          {t("mercari.actionFailed")}: {error.message}
        </p>
      )}
    </div>
  );
}

function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  labelFor,
  disabled,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  labelFor: (option: T) => string;
  disabled?: (option: T) => boolean;
  onChange: (option: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="min-w-0 space-y-1.5">
      <p className="text-sm font-medium" aria-hidden="true">{label}</p>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <Button
            key={option}
            type="button"
            // The lane decides what every number on the page means, so the
            // active choice takes the primary fill rather than a faint tint.
            variant={option === value ? "default" : "outline"}
            className="h-11 px-3 sm:h-8"
            aria-pressed={option === value}
            disabled={disabled?.(option) ?? false}
            onClick={() => onChange(option)}
          >
            {labelFor(option)}
          </Button>
        ))}
      </div>
    </div>
  );
}

function LeadCard({
  lead,
  actor,
  onActed,
}: {
  lead: MercariLead;
  actor: MercariLeadActor;
  onActed: (action: MercariLeadAction, reason: string) => void;
}) {
  const { t, language } = useTranslation();

  // Listings live in Japan, so times are pinned to JST like the Arrivals and
  // verified Mercari tabs rather than rendered in the viewer's local zone.
  const dateTime = (value: string | null) => {
    if (value === null) return t("mercari.unknownTime");
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return t("mercari.unknownTime");
    return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Tokyo",
    }).format(parsed);
  };

  const age = (hours: number) => {
    if (hours < 1) return unbroken(t("mercariLeads.ageUnderHour"));
    if (hours < 48) return unbroken(t("mercariLeads.ageHours", { hours: Math.floor(hours) }));
    return unbroken(t("mercariLeads.ageDays", { days: Math.floor(hours / 24) }));
  };

  const multipleText = (value: number) => t("mercariLeads.multipleValue", {
    multiple: new Intl.NumberFormat(language === "ja" ? "ja-JP" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value),
  });

  const cardLabel = `${lead.regional_name} (${lead.set_code}${isUnknown(lead.card_number) ? "" : ` ${lead.card_number}`})`;
  const holderLabel = lead.holder_hint === "psa_unknown"
    ? t("mercariLeads.psaGradeUnread")
    : lead.title_psa_grade !== null
      ? t("mercari.psaGrade", { grade: lead.title_psa_grade })
      : t("mercari.raw");
  const unpricedKey = UNPRICED_KEYS[lead.unpriced_reason ?? ""];
  const unpricedReason = unpricedKey
    ? t(unpricedKey, { grade: lead.title_psa_grade ?? "" })
    : t("mercariLeads.unpricedReasonOther", { reason: lead.unpriced_reason ?? "" });
  const unpricedText = lead.value_sample_count > 0
    ? `${unpricedReason} (${t("mercariLeads.salesFound", { count: lead.value_sample_count })})`
    : unpricedReason;
  const basisKey = VALUE_BASIS_KEYS[lead.value_basis];
  const basis = basisKey ? t(basisKey) : t("mercariLeads.valueBasisOther", { basis: lead.value_basis });
  const damaged = lead.value_condition === "damaged_p25";
  const valueHolder = lead.value_psa_grade !== null && lead.value_psa_grade > 0
    ? t("mercariLeads.valueAtGrade", { grade: lead.value_psa_grade })
    : damaged
      ? t("mercariLeads.valueDamaged")
      : t("mercariLeads.valueRaw");
  const withheldText = lead.multiple_withheld_reason === null
    ? null
    : lead.multiple_withheld_reason === "psa_thin_comps"
      ? t(lead.value_sample_count === 1 ? "mercariLeads.withheld.psa_thin_comps_one" : "mercariLeads.withheld.psa_thin_comps", {
        count: lead.value_sample_count,
        grade: lead.title_psa_grade ?? "",
      })
      : t(WITHHELD_KEYS[lead.multiple_withheld_reason]);
  const listedKey: TranslationKey = lead.source_created_at ? "mercariLeads.listedAgo" : "mercariLeads.firstSeenAgo";
  const setLabel = lead.set_name ? `${lead.set_name} (${lead.set_code})` : lead.set_code;
  // Edition and finish come from the typed axes, never from misc_info alone.
  const variant = pokemonVariantLabel(lead);
  const tierKey = MATCH_TIER_KEYS[lead.match_tier];
  const photo = photoStatus(lead);
  // An auction (backend #2436): its shown price is the current bid, so the card
  // leads with the highest bid that still clears the bars, then the bid, the
  // bid count and the end, each said to be unknown when no scan read it. Hours
  // to the end are taken at read time, as every age on the card is.
  const auction = lead.listing_format === "auction";
  const maxBid = lead.auction_max_bid_jpy;
  const bidsText = lead.auction_bid_count === null
    ? t("mercariLeads.auction.bidsUnknown")
    : t(lead.auction_bid_count === 1 ? "mercariLeads.auction.bidsOne" : "mercariLeads.auction.bids", { count: lead.auction_bid_count });
  const endText = lead.auction_ends_at === null
    ? t("mercariLeads.auction.endUnknown")
    : lead.auction_ended
      ? t("mercariLeads.auction.ended", { date: dateTime(lead.auction_ends_at) })
      : t("mercariLeads.auction.ends", {
        date: dateTime(lead.auction_ends_at),
        in: age(Math.max(0, hoursUntilAtRead(lead, lead.auction_ends_at))),
      });
  const markLost = auction && lead.auction_last_seen_at !== null
    && Date.parse(lead.auction_last_seen_at) < Date.parse(lead.observed_at);
  return (
    <Card className="min-w-0" data-testid="mercari-lead-card">
      <CardHeader className="space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {auction && (
            <Badge
              variant="outline"
              className={`h-auto gap-1 px-2 py-0.5 text-sm font-semibold ${lead.auction_ended ? AUCTION_ENDED_CLASS : AUCTION_CLASS}`}
              data-testid="mercari-lead-auction"
            >
              <Gavel className="size-3.5" aria-hidden="true" />
              {t(lead.auction_ended ? "mercariLeads.auction.badgeEnded" : "mercariLeads.auction.badge")}
            </Badge>
          )}
          <Badge
            variant="outline"
            className={`h-auto gap-1 px-2 py-0.5 text-sm font-semibold ${ageClass(lead.listing_age_hours)}`}
            data-testid="mercari-lead-age"
          >
            <Clock className="size-3.5" aria-hidden="true" />
            {t(listedKey, { age: age(lead.listing_age_hours) })}
          </Badge>
          {/* Every lead is a fresh lead-scan row now, so only the exception is named. */}
          {lead.source_kind !== "lead_scan" && (
            <Badge variant="outline" className="text-muted-foreground" data-testid="mercari-lead-source">
              {t(SOURCE_KIND_KEYS[lead.source_kind])}
            </Badge>
          )}
          <Badge variant="outline" className={photo.className} data-testid="mercari-lead-photo">
            {t(photo.key)}
          </Badge>
          <Badge variant="outline">{holderLabel}</Badge>
          {lead.source_status !== "ON_SALE" && (
            <Badge variant="outline" className="border-red-500/50 bg-red-500/10 text-red-800 dark:text-red-200">
              {t(STATUS_KEYS[lead.source_status])}
            </Badge>
          )}
          {lead.dismissed && <Badge variant="outline">{t("mercari.dismissed")}</Badge>}
          {/* A fresh lead's request is its queued badge; a cold-crawl lead's is recorded only. */}
          {lead.source_kind === "cold_crawl" && lead.photo_check_requested && (
            <Badge variant="outline">{t("mercariLeads.photoCheckRequested")}</Badge>
          )}
        </div>
        <CardTitle className="min-w-0 break-words text-base leading-snug">
          {/* A one-line title still gets a 44px target on a phone. */}
          <a
            href={lead.canonical_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0"
          >
            <span>
              {lead.sanitized_title}
              <ExternalLink className="ml-1 inline size-3.5 align-baseline text-muted-foreground" aria-hidden="true" />
            </span>
          </a>
        </CardTitle>
        <CardDescription className="break-words">
          {t("mercariLeads.observed")}: {dateTime(lead.observed_at)} ({t("mercariLeads.observedAgo", { age: age(lead.observed_age_hours) })})
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border bg-muted/30 px-3 py-2" data-testid="mercari-lead-multiple">
          {auction ? (
            <div className="space-y-1" data-testid="mercari-lead-auction-summary">
              {maxBid !== null ? (
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-2xl font-semibold tabular-nums" data-testid="mercari-lead-max-bid">
                    {formatJpy(maxBid)}
                  </span>
                  <span className="text-xs text-muted-foreground">{t("mercariLeads.auction.maxBidHint")}</span>
                </div>
              ) : lead.lane === "unpriced" ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">{t("mercariLeads.unpriced")}: </span>
                  {unpricedText}
                </p>
              ) : (
                <p className="text-sm">{withheldText ?? t("mercariLeads.auction.noMaxBid")}</p>
              )}
              <p className="text-sm">
                <span className="text-muted-foreground">{t("mercariLeads.auction.currentBid")}: </span>
                <span className="font-medium tabular-nums">{formatJpy(lead.ask_jpy)}</span>
                {maxBid !== null && (
                  <span className="text-muted-foreground">
                    {" · "}
                    {maxBid > lead.ask_jpy
                      ? t("mercariLeads.auction.headroom", { jpy: formatJpy(maxBid - lead.ask_jpy) })
                      : t("mercariLeads.auction.atMax")}
                  </span>
                )}
              </p>
              {maxBid !== null && withheldText !== null && (
                <p className="text-xs text-muted-foreground">{withheldText}</p>
              )}
              <p className="text-xs text-muted-foreground" data-testid="mercari-lead-auction-facts">
                <span className="whitespace-nowrap">{bidsText}</span>
                {" · "}
                {endText}
              </p>
            </div>
          ) : lead.multiple !== null ? (
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={`text-2xl font-semibold tabular-nums ${lead.multiple >= 2 ? "text-emerald-700 dark:text-emerald-300" : ""}`}>
                {multipleText(lead.multiple)}
              </span>
              <span className="text-xs text-muted-foreground">
                {t(damaged ? "mercariLeads.multipleHintDamaged" : "mercariLeads.multipleHint")}
              </span>
            </div>
          ) : withheldText !== null ? (
            <p className="text-sm">{withheldText}</p>
          ) : (
            <p className="text-sm">
              <span className="text-muted-foreground">{t("mercariLeads.unpriced")}: </span>
              {unpricedText}
            </p>
          )}
          {lead.lane === "unpriced" && lead.other_listings > 0 && (
            <p className="mt-1 text-sm">
              <span className="font-medium">{t("mercariLeads.otherListings", { count: lead.other_listings })}</span>
              <span className="text-muted-foreground">
                {" · "}
                {t(auction ? "mercariLeads.auction.otherListingsHint" : "mercariLeads.otherListingsHint")}
              </span>
            </p>
          )}
        </div>
        <div className="grid min-w-0 grid-cols-[5rem_1fr] gap-3 sm:grid-cols-[7rem_1fr]">
          <div className="flex aspect-[3/4] min-w-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
            {lead.image_url ? (
              <img
                src={previewURL(lead.image_url)}
                alt={t("mercari.imageAlt", { card: cardLabel })}
                className="h-full w-full object-contain"
                loading="lazy"
              />
            ) : (
              <Info className="size-5 text-muted-foreground" aria-hidden="true" />
            )}
          </div>
          <dl className="min-w-0 space-y-1.5 text-sm">
            <div>
              <dt className="text-muted-foreground">{t("mercariLeads.card")}</dt>
              <dd className="break-words">
                <span className="font-medium">{lead.regional_name}</span>
                {lead.english_name && lead.english_name !== lead.regional_name ? ` · ${lead.english_name}` : ""}
                <br />
                {setLabel}
                {isUnknown(lead.card_number) ? "" : ` ${lead.card_number}`}
                {variant ? <>{" · "}<span className="whitespace-nowrap">{variant}</span></> : null}
              </dd>
              <dd className="text-xs text-muted-foreground" data-testid="mercari-lead-match">
                {t("mercariLeads.matchedBy", {
                  tier: tierKey ? t(tierKey) : lead.match_tier,
                })}
              </dd>
              {lead.card_resolution === "unresolved" && (
                <dd className="text-xs text-muted-foreground">{t("mercariLeads.unresolved")}</dd>
              )}
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">{t(auction ? "mercariLeads.auction.currentBid" : "mercari.ask")}</dt>
              <dd className="font-medium">
                {formatJpy(lead.ask_jpy)}
                {lead.shipping_added_jpy > 0 ? ` ${t("mercariLeads.shippingAdded", { jpy: formatJpy(lead.shipping_added_jpy) })}` : ""}
                {" · "}
                {t("mercariLeads.landed", { usd: formatUsd(lead.landed_ask_usd) })}
              </dd>
              {lead.buyer_pays_shipping && (
                <dd>
                  <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200">
                    {t("mercariLeads.buyerPaysShipping")}
                  </Badge>
                </dd>
              )}
              {markLost && lead.auction_last_seen_at !== null && (
                <dd className="basis-full text-xs text-muted-foreground" data-testid="mercari-lead-auction-mark-lost">
                  {t("mercariLeads.auction.markLost", { age: age(hoursAtRead(lead, lead.auction_last_seen_at)) })}
                </dd>
              )}
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">{t("mercari.sellerCondition")}</dt>
              <dd>{t(SELLER_CONDITION_KEYS[lead.seller_condition_id])}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("mercariLeads.value")}</dt>
              {lead.value_usd !== null ? (
                <>
                  <dd>
                    <span className="font-medium">{formatUsd(lead.value_usd)}</span>
                    {" · "}
                    {t("mercariLeads.valueLine", { basis, holder: valueHolder })}
                  </dd>
                  {damaged && lead.nm_value_usd !== null && (
                    <dd className="text-xs text-muted-foreground" data-testid="mercari-lead-nm-value">
                      {t("mercariLeads.nmValue", { value: formatUsd(lead.nm_value_usd) })}
                    </dd>
                  )}
                  <dd className="text-xs text-muted-foreground" data-testid="mercari-lead-evidence">
                    {lead.value_window_days !== null
                      ? t("mercariLeads.valueEvidence", {
                        count: lead.value_sample_count,
                        days: lead.value_window_days,
                        date: unbroken(formatDate(lead.value_as_of, language)),
                      })
                      : t("mercariLeads.valueEvidenceNoWindow", {
                        count: lead.value_sample_count,
                        date: unbroken(formatDate(lead.value_as_of, language)),
                      })}
                  </dd>
                  {lead.net_value_usd !== null && (
                    <dd className="text-xs text-muted-foreground">
                      {lead.selling_cost_usd !== null
                        ? t("mercariLeads.netValueDetail", {
                          net: formatUsd(lead.net_value_usd),
                          costs: formatUsd(lead.selling_cost_usd),
                        })
                        : t("mercariLeads.netValue", { net: formatUsd(lead.net_value_usd) })}
                    </dd>
                  )}
                </>
              ) : (
                <dd className="text-muted-foreground">
                  {lead.holder_hint === "psa_unknown"
                    ? t("mercariLeads.noValuePsaUnread")
                    : t("mercariLeads.noValue")}
                </dd>
              )}
            </div>
          </dl>
        </div>
        {lead.photo_check_state === "conflict" && (
          <div className="grid min-w-0 grid-cols-[3.5rem_1fr] gap-3 rounded-lg border border-red-500/40 bg-red-500/5 p-2" data-testid="mercari-lead-photo-card">
            <div className="flex aspect-[3/4] min-w-0 items-center justify-center overflow-hidden rounded border bg-muted">
              {lead.photo_image_url ? (
                <img
                  src={previewURL(lead.photo_image_url)}
                  alt={t("mercariLeads.photoCardAlt", { card: lead.photo_regional_name ?? "" })}
                  className="h-full w-full object-contain"
                  loading="lazy"
                />
              ) : (
                <Camera className="size-4 text-muted-foreground" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 text-sm">
              <p className="text-muted-foreground">{t("mercariLeads.photoCard")}</p>
              <p className="break-words">
                {lead.photo_regional_name !== null ? (
                  <>
                    <span className="font-medium">{lead.photo_regional_name}</span>
                    {lead.photo_english_name && lead.photo_english_name !== lead.photo_regional_name ? ` · ${lead.photo_english_name}` : ""}
                    {lead.photo_set_code ? ` · ${lead.photo_set_code}` : ""}
                    {isUnknown(lead.photo_card_number) ? "" : ` ${lead.photo_card_number}`}
                  </>
                ) : lead.photo_source_card_uid !== null ? (
                  t("mercariLeads.photoCardUnresolved")
                ) : lead.source_kind === "lead_scan" && lead.photo_psa_grade !== null ? (
                  t("mercariLeads.photoCardOtherGrade")
                ) : (
                  t("mercariLeads.photoCardNone")
                )}
                {lead.photo_psa_grade !== null ? ` · ${t("mercari.psaGrade", { grade: lead.photo_psa_grade })}` : ""}
              </p>
            </div>
          </div>
        )}
        {photo.note !== null && (
          <p className="text-xs text-muted-foreground" data-testid="mercari-lead-photo-note">
            {t(photo.note)}
          </p>
        )}
        {lead.photo_checked_at !== null && (
          <p className="text-xs text-muted-foreground" data-testid="mercari-lead-photo-checked">
            {t("mercariLeads.photoChecked")}: {dateTime(lead.photo_checked_at)} ({t("mercariLeads.observedAgo", { age: age(hoursAtRead(lead, lead.photo_checked_at)) })})
          </p>
        )}
        {lead.dismissed && lead.latest_lead_action_reason && (
          <p className="text-sm text-muted-foreground">
            {t("mercari.dismissedBecause", { reason: lead.latest_lead_action_reason })}
          </p>
        )}
        <LeadActions
          lead={lead}
          actor={actor}
          onActed={onActed}
        />
      </CardContent>
    </Card>
  );
}

function readFiltersFromUrl(base: MercariLeadFilters): MercariLeadFilters {
  return {
    ...base,
    lane: parseMercariLaneParam(readUrlParam(MERCARI_LANE_PARAM)) ?? DEFAULT_MERCARI_LANE,
    format: parseMercariFormatParam(readUrlParam(MERCARI_FORMAT_PARAM)) ?? DEFAULT_MERCARI_FORMAT,
    sort: parseMercariSortParam(readUrlParam(MERCARI_SORT_PARAM)) ?? DEFAULT_MERCARI_SORT,
  };
}

export default function MercariLeadsView({
  loader = loadMercariLeads,
  actor = recordMercariLeadAction,
}: {
  loader?: MercariLeadsLoader;
  actor?: MercariLeadActor;
}) {
  const { t, language } = useTranslation();
  // Lane and sort are leaf URL params (?lane=, ?sort=) so one lane can be
  // linked and bookmarked; the defaults stay out of the URL.
  const [filters, setFilters] = useState<MercariLeadFilters>(() => readFiltersFromUrl(DEFAULT_LEAD_FILTERS));
  const [leads, setLeads] = useState<MercariLead[]>([]);
  const [nextCursor, setNextCursor] = useState<MercariLeadCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);
  const requestGeneration = useRef(0);

  const sort = effectiveSort(filters);

  useEffect(() => {
    writeUrlParam(MERCARI_LANE_PARAM, filters.lane === DEFAULT_MERCARI_LANE ? null : filters.lane);
    writeUrlParam(MERCARI_FORMAT_PARAM, filters.format === DEFAULT_MERCARI_FORMAT ? null : filters.format);
    // Each format's first sort is its default, so it stays out of the URL.
    writeUrlParam(MERCARI_SORT_PARAM, filters.sort === sortsFor(filters.format)[0] ? null : filters.sort);
  }, [filters.lane, filters.format, filters.sort]);

  useEffect(() => {
    const onPop = () => setFilters((current) => readFiltersFromUrl(current));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const load = useCallback(async (
    requested: MercariLeadFilters,
    cursor: MercariLeadCursor | null,
    append: boolean,
  ) => {
    const generation = ++requestGeneration.current;
    if (append) {
      setLoadingMore(true);
      setLoadMoreError(null);
    } else {
      setLoading(true);
      setError(null);
      setLoadMoreError(null);
      setLeads([]);
      setNextCursor(null);
    }
    try {
      const page = await loader({ ...requested, sort: effectiveSort(requested) }, cursor);
      if (requestGeneration.current !== generation) return;
      setLeads((current) => {
        if (!append) return page.leads;
        const seen = new Set(current.map((lead) => lead.external_item_id));
        return [
          ...current,
          ...page.leads.filter((lead) => {
            if (seen.has(lead.external_item_id)) return false;
            seen.add(lead.external_item_id);
            return true;
          }),
        ];
      });
      setNextCursor(page.nextCursor);
    } catch (reason) {
      if (requestGeneration.current !== generation) return;
      const failure = asError(reason);
      if (append) setLoadMoreError(failure);
      else setError(failure);
    } finally {
      if (requestGeneration.current === generation) {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    }
  }, [loader]);

  useEffect(() => {
    void load(filters, null, false);
  }, [filters, load]);

  const change = (patch: Partial<MercariLeadFilters>) => setFilters((current) => ({ ...current, ...patch }));

  const markActed = useCallback((externalItemId: string, action: MercariLeadAction, reason: string) => {
    const actedAt = new Date().toISOString();
    // The view reads the latest action, so a photo-check request after a
    // dismissal brings the lead back, and the local row says the same.
    setLeads((current) => current.map((lead) => (
      lead.external_item_id === externalItemId
        ? {
          ...lead,
          latest_lead_action: action,
          latest_lead_action_reason: reason || null,
          latest_lead_action_at: actedAt,
          dismissed: action === "dismissed",
          photo_check_requested: action === "photo_check_requested",
        }
        : lead
    )));
  }, []);

  return (
    <section className="mx-auto w-full max-w-6xl min-w-0 space-y-4" aria-labelledby="mercari-leads-title">
      <div className="space-y-1">
        <h1 id="mercari-leads-title" className="text-xl font-semibold sm:text-2xl">
          {t("mercariLeads.title")}
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("mercariLeads.subtitle")}
        </p>
      </div>

      <div className="min-w-0 space-y-3 rounded-xl border bg-card p-3">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-start lg:justify-between">
          {/* Auctions are a feed of their own, never ranked against fixed-price leads. */}
          <ChoiceGroup
            label={t("mercariLeads.formatLabel")}
            options={MERCARI_LEAD_FORMATS}
            value={filters.format}
            labelFor={(format) => t(FORMAT_KEYS[format])}
            onChange={(format) => change({ format, sort: sortsFor(format)[0] })}
          />
          <ChoiceGroup
            label={t("mercariLeads.laneLabel")}
            options={MERCARI_LEAD_LANES}
            value={filters.lane}
            labelFor={(lane) => t(LANE_KEYS[lane])}
            onChange={(lane) => change({ lane })}
          />
          <ChoiceGroup
            label={t("mercariLeads.sortLabel")}
            options={sortsFor(filters.format)}
            value={sort}
            labelFor={(option) => t(SORT_KEYS[option])}
            disabled={(option) => filters.format === "fixed_price" && filters.lane === "unpriced" && option === "multiple"}
            onChange={(option) => change({ sort: option })}
          />
        </div>
        <p className="text-xs text-muted-foreground" data-testid="mercari-lane-hint">
          {t(LANE_HINT_KEYS[filters.lane])}
          {filters.format === "fixed_price" && filters.lane === "unpriced" ? ` ${t("mercariLeads.sortUnpricedNote")}` : ""}
        </p>
        {filters.format === "auction" && (
          <p className="text-xs text-muted-foreground" data-testid="mercari-format-hint">
            {t("mercariLeads.formatHint.auction")}
          </p>
        )}
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-0 space-y-1.5 sm:w-64">
            <Label htmlFor="mercari-lead-photo-filter">{t("mercariLeads.photoFilter")}</Label>
            <select
              id="mercari-lead-photo-filter"
              className="flex h-11 w-full rounded-md border border-input bg-background px-2 text-sm sm:h-8"
              value={filters.photo}
              onChange={(event) => change({ photo: event.target.value as MercariLeadFilters["photo"] })}
            >
              <option value="">{t("mercariLeads.photoAll")}</option>
              {PHOTO_STATES.map((state) => (
                <option key={state} value={state}>{t(PHOTO_KEYS[state])}</option>
              ))}
            </select>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
            <input
              type="checkbox"
              className="size-4"
              checked={filters.includeUnavailable}
              onChange={(event) => change({ includeUnavailable: event.target.checked })}
            />
            {t("mercariLeads.includeUnavailable")}
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
            <input
              type="checkbox"
              className="size-4"
              checked={filters.includeDismissed}
              onChange={(event) => change({ includeDismissed: event.target.checked })}
            />
            {t("mercariLeads.includeDismissed")}
          </label>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full sm:ml-auto sm:h-8 sm:w-auto"
            disabled={loading}
            onClick={() => void load(filters, null, false)}
          >
            <RefreshCw aria-hidden="true" />
            {t("mercariLeads.refresh")}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          {t("mercariLeads.loading")}
        </div>
      ) : error ? (
        <LoadFailure
          error={error}
          title={t("mercariLeads.errorTitle")}
          onRetry={() => void load(filters, null, false)}
        />
      ) : leads.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="font-medium">{t("mercariLeads.emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("mercariLeads.emptyBody")}</p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-4 md:grid-cols-2" data-testid="mercari-lead-list">
          {leads.map((lead) => (
            <LeadCard
              key={lead.external_item_id}
              lead={lead}
              actor={actor}
              onActed={(action, reason) => markActed(lead.external_item_id, action, reason)}
            />
          ))}
        </div>
      )}
      {!loading && !error && leads.length > 0 && (
        <div className="space-y-3">
          {loadMoreError && (
            <LoadFailure
              error={loadMoreError}
              title={t("mercariLeads.moreErrorTitle")}
              onRetry={() => void load(filters, nextCursor, true)}
            />
          )}
          {nextCursor && !loadMoreError && (
            <Button
              className="h-11 w-full sm:w-auto"
              variant="outline"
              disabled={loadingMore}
              onClick={() => void load(filters, nextCursor, true)}
            >
              {loadingMore ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-4" aria-hidden="true" />
              )}
              {loadingMore ? t("mercariLeads.loadingMore") : t("mercariLeads.loadMore")}
            </Button>
          )}
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground" role="note">
            <Info className="mt-px size-4 shrink-0" aria-hidden="true" />
            {t("mercariLeads.evidenceNote")}
          </p>
        </div>
      )}
    </section>
  );
}
