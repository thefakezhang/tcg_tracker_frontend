"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Clock, EyeOff, ExternalLink, Info, LoaderCircle, RefreshCw } from "lucide-react";

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
import {
  LoadFailure,
  SELLER_CONDITION_KEYS,
  previewURL,
  type MercariSellerConditionID,
} from "./MercariDealsView";
import {
  DEFAULT_MERCARI_LANE,
  DEFAULT_MERCARI_SORT,
  MERCARI_LANE_PARAM,
  MERCARI_LEAD_LANES,
  MERCARI_LEAD_SORTS,
  MERCARI_SORT_PARAM,
  parseMercariLaneParam,
  parseMercariSortParam,
  readUrlParam,
  writeUrlParam,
  type MercariLeadLane,
  type MercariLeadSort,
} from "./url-params";

export type { MercariLeadLane, MercariLeadSort } from "./url-params";
export type MercariPhotoState = "unchecked" | "confirmed" | "conflict" | "inconclusive" | "rejected";
export type MercariLeadAction = "dismissed" | "photo_check_requested";
export type MercariSourceStatus = "ON_SALE" | "TRADING" | "SOLD_OUT" | "UNKNOWN";
export type MercariWithheldReason = "seller_condition_3_6" | "psa_grade_unread";

// One row of the backend view mercari_leads_v (migration 000616), restricted
// to the columns the feed shows. The parser below holds every row to the
// lane rules the table's CHECKs enforce, so a row that breaks one fails
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
  candidate_count: number;
  ambiguous: boolean;
  card_resolution: "uid" | "identity" | "unresolved";
  regional_name: string;
  english_name: string | null;
  set_code: string;
  set_name: string | null;
  card_number: string | null;
  misc_info: string | null;
  image_url: string | null;
  lane: MercariLeadLane;
  value_usd: number | null;
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
};

export type MercariLeadFilters = {
  lane: MercariLeadLane;
  sort: MercariLeadSort;
  // "" is every photo state except rejected.
  photo: "" | MercariPhotoState;
  includeDismissed: boolean;
  includeUnavailable: boolean;
};

export type MercariLeadCursor = {
  after: string | null;
  after_key: string;
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
const WITHHELD_REASONS = new Set(["seller_condition_3_6", "psa_grade_unread"]);

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
    const unpricedReason = optionalString(row.unpriced_reason, "unpriced_reason");

    // The value rules. A raw lane carries a raw value; a PSA lane carries a
    // value at exactly the title's grade, or none when the grade is unread; an
    // unpriced row carries none. Anything else would put a raw value on a slab
    // or a neighbouring grade's value on this one, so it never renders.
    if (lane === "modern_raw" || lane === "vintage_raw") {
      if (holderHint !== "holder_unknown" || valueUsd === null || valueGrade !== 0) throw invalid("raw value", index);
    } else if (lane === "psa") {
      if (holderHint === "psa_unknown") {
        if (valueUsd !== null || valueGrade !== null || multiple !== null) throw invalid("PSA value", index);
      } else if (titleGrade === null || valueUsd === null || valueGrade !== titleGrade) {
        throw invalid("PSA value", index);
      }
    } else if (valueUsd !== null || valueGrade !== null || multiple !== null
      || holderHint === "psa_unknown" || unpricedReason === null || unpricedReason.trim() === "") {
      throw invalid("unpriced row", index);
    }
    if (valueUsd !== null && valueUsd <= 0) throw invalid("value", index);
    if ((valueUsd === null) !== (netValue === null)) throw invalid("net value", index);
    if (multiple !== null && (multiple < 0 || netValue === null || netValue <= 0)) throw invalid("multiple", index);
    if (lane !== "unpriced" && (multiple === null) !== (withheld !== null)) throw invalid("withheld reason", index);

    const valueAsOf = optionalString(row.value_as_of, "value_as_of");
    if ((valueAsOf === null) !== (valueUsd === null) || (valueAsOf !== null && !DATE_ONLY.test(valueAsOf))) {
      throw invalid("value date", index);
    }
    const windowDays = optionalInteger(row.value_window_days, "value_window_days");
    if (windowDays !== null && windowDays !== 60 && windowDays !== 180) throw invalid("value window", index);
    const sampleCount = requiredInteger(row.value_sample_count, "value_sample_count");
    if (sampleCount < 0) throw invalid("sample count", index);

    const ask = requiredNumber(row.ask_jpy, "ask_jpy");
    if (ask <= 0) throw invalid("ask", index);
    const landed = requiredNumber(row.landed_ask_usd, "landed_ask_usd");
    if (landed <= 0) throw invalid("landed ask", index);
    const shippingPayer = oneOf<MercariLead["shipping_payer"]>(SHIPPING_PAYERS, row.shipping_payer, "shipping payer", index);
    const buyerPays = requiredBoolean(row.buyer_pays_shipping, "buyer_pays_shipping");
    if (buyerPays !== (shippingPayer === "buyer")) throw invalid("shipping payer", index);
    const shippingAdded = requiredInteger(row.shipping_added_jpy, "shipping_added_jpy");
    if (shippingAdded < 0 || (!buyerPays && shippingAdded !== 0)) throw invalid("shipping", index);

    const candidateCount = requiredInteger(row.candidate_count, "candidate_count");
    const ambiguous = requiredBoolean(row.ambiguous, "ambiguous");
    if (candidateCount < 1 || ambiguous !== (candidateCount > 1)) throw invalid("candidates", index);
    const otherListings = requiredInteger(row.other_listings, "other_listings");
    if (otherListings < 0) throw invalid("other listings", index);

    const action = optionalString(row.latest_lead_action, "latest_lead_action");
    if (action !== null && action !== "dismissed" && action !== "photo_check_requested") {
      throw invalid("action", index);
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
      seller_condition_id: oneOf<MercariSellerConditionID>(SELLER_CONDITIONS, row.seller_condition_id, "seller condition", index),
      source_status: oneOf<MercariSourceStatus>(SOURCE_STATUSES, row.source_status, "source status", index),
      source_created_at: optionalTimestamp(row.source_created_at, "source_created_at"),
      first_seen_at: requiredTimestamp(row.first_seen_at, "first_seen_at"),
      observed_at: requiredTimestamp(row.observed_at, "observed_at"),
      listing_age_hours: requiredNumber(row.listing_age_hours, "listing_age_hours"),
      observed_age_hours: requiredNumber(row.observed_age_hours, "observed_age_hours"),
      holder_hint: holderHint,
      title_psa_grade: titleGrade,
      candidate_count: candidateCount,
      ambiguous,
      card_resolution: oneOf<MercariLead["card_resolution"]>(RESOLUTIONS, row.card_resolution, "card resolution", index),
      regional_name: requiredString(row.regional_name, "regional_name"),
      english_name: optionalString(row.english_name, "english_name"),
      set_code: requiredString(row.set_code, "set_code"),
      set_name: optionalString(row.set_name, "set_name"),
      card_number: optionalString(row.card_number, "card_number"),
      misc_info: optionalString(row.misc_info, "misc_info"),
      image_url: imageURL(row.image_url, "image_url"),
      lane,
      value_usd: valueUsd,
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
      photo_check_state: oneOf<MercariPhotoState>(new Set(PHOTO_STATES), row.photo_check_state, "photo state", index),
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
  return { after, after_key: afterKey };
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
  const query = new URLSearchParams({ lane: filters.lane, sort: filters.sort, limit: String(PAGE_SIZE) });
  if (filters.photo) query.set("photo", filters.photo);
  if (filters.includeDismissed) query.set("include_dismissed", "1");
  if (filters.includeUnavailable) query.set("include_unavailable", "1");
  if (cursor) {
    // A best-multiple page can end inside the rows without a multiple.
    query.set("after", cursor.after ?? "null");
    query.set("after_key", cursor.after_key);
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

/** Unpriced leads carry no multiple, so "Best multiple" would only be id order there. */
export function effectiveSort(filters: MercariLeadFilters): MercariLeadSort {
  return filters.lane === "unpriced" ? "newest" : filters.sort;
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
};

const PHOTO_KEYS: Record<MercariPhotoState, TranslationKey> = {
  unchecked: "mercariLeads.photo.unchecked",
  confirmed: "mercariLeads.photo.confirmed",
  conflict: "mercariLeads.photo.conflict",
  inconclusive: "mercariLeads.photo.inconclusive",
  rejected: "mercariLeads.photo.rejected",
};

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

const WITHHELD_KEYS: Record<MercariWithheldReason, TranslationKey> = {
  seller_condition_3_6: "mercariLeads.withheld.seller_condition_3_6",
  psa_grade_unread: "mercariLeads.withheld.psa_grade_unread",
};

const UNPRICED_KEYS: Record<string, TranslationKey> = {
  no_raw_comps_180d: "mercariLeads.unpricedReason.no_raw_comps_180d",
  thin_raw_comps_180d: "mercariLeads.unpricedReason.thin_raw_comps_180d",
  no_psa_comps_at_grade_180d: "mercariLeads.unpricedReason.no_psa_comps_at_grade_180d",
  card_unresolved: "mercariLeads.unpricedReason.card_unresolved",
};

// The listing's age decides whether a lead is still worth opening, because
// the first leads come from a crawl several days old. Fresh under a day,
// aging under three, old after that.
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
  // A photo that already agrees with the title needs no second check.
  const canRequestPhoto = !lead.photo_check_requested && lead.photo_check_state !== "confirmed";
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
  const valueHolder = lead.value_psa_grade !== null && lead.value_psa_grade > 0
    ? t("mercariLeads.valueAtGrade", { grade: lead.value_psa_grade })
    : t("mercariLeads.valueRaw");
  const listedKey: TranslationKey = lead.source_created_at ? "mercariLeads.listedAgo" : "mercariLeads.firstSeenAgo";
  const setLabel = lead.set_name ? `${lead.set_name} (${lead.set_code})` : lead.set_code;
  return (
    <Card className="min-w-0" data-testid="mercari-lead-card">
      <CardHeader className="space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={`h-auto gap-1 px-2 py-0.5 text-sm font-semibold ${ageClass(lead.listing_age_hours)}`}
            data-testid="mercari-lead-age"
          >
            <Clock className="size-3.5" aria-hidden="true" />
            {t(listedKey, { age: age(lead.listing_age_hours) })}
          </Badge>
          <Badge variant="outline" className={PHOTO_CLASSES[lead.photo_check_state]} data-testid="mercari-lead-photo">
            {t(PHOTO_KEYS[lead.photo_check_state])}
          </Badge>
          <Badge variant="outline">{holderLabel}</Badge>
          {lead.ambiguous && (
            <Badge variant="outline">{t("mercariLeads.ambiguousBadge", { count: lead.candidate_count })}</Badge>
          )}
          {lead.source_status !== "ON_SALE" && (
            <Badge variant="outline" className="border-red-500/50 bg-red-500/10 text-red-800 dark:text-red-200">
              {t(STATUS_KEYS[lead.source_status])}
            </Badge>
          )}
          {lead.dismissed && <Badge variant="outline">{t("mercari.dismissed")}</Badge>}
          {lead.photo_check_requested && (
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
          {lead.multiple !== null ? (
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={`text-2xl font-semibold tabular-nums ${lead.multiple >= 2 ? "text-emerald-700 dark:text-emerald-300" : ""}`}>
                {multipleText(lead.multiple)}
              </span>
              <span className="text-xs text-muted-foreground">{t("mercariLeads.multipleHint")}</span>
            </div>
          ) : lead.multiple_withheld_reason !== null ? (
            <p className="text-sm">{t(WITHHELD_KEYS[lead.multiple_withheld_reason])}</p>
          ) : (
            <p className="text-sm">
              <span className="text-muted-foreground">{t("mercariLeads.unpriced")}: </span>
              {unpricedText}
            </p>
          )}
          {lead.lane === "unpriced" && lead.other_listings > 0 && (
            <p className="mt-1 text-sm">
              <span className="font-medium">{t("mercariLeads.otherListings", { count: lead.other_listings })}</span>
              <span className="text-muted-foreground"> · {t("mercariLeads.otherListingsHint")}</span>
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
                {isUnknown(lead.misc_info) ? "" : ` · ${lead.misc_info}`}
              </dd>
              {lead.ambiguous && (
                <dd className="text-xs text-muted-foreground">{t("mercariLeads.ambiguous", { count: lead.candidate_count })}</dd>
              )}
              {lead.card_resolution === "unresolved" && (
                <dd className="text-xs text-muted-foreground">{t("mercariLeads.unresolved")}</dd>
              )}
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">{t("mercari.ask")}</dt>
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
                ) : (
                  t("mercariLeads.photoCardNone")
                )}
                {lead.photo_psa_grade !== null ? ` · ${t("mercari.psaGrade", { grade: lead.photo_psa_grade })}` : ""}
              </p>
            </div>
          </div>
        )}
        {lead.photo_checked_at !== null && (
          <p className="text-xs text-muted-foreground">
            {t("mercariLeads.photoChecked")}: {dateTime(lead.photo_checked_at)}
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
    writeUrlParam(MERCARI_SORT_PARAM, filters.sort === DEFAULT_MERCARI_SORT ? null : filters.sort);
  }, [filters.lane, filters.sort]);

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
          <ChoiceGroup
            label={t("mercariLeads.laneLabel")}
            options={MERCARI_LEAD_LANES}
            value={filters.lane}
            labelFor={(lane) => t(LANE_KEYS[lane])}
            onChange={(lane) => change({ lane })}
          />
          <ChoiceGroup
            label={t("mercariLeads.sortLabel")}
            options={MERCARI_LEAD_SORTS}
            value={sort}
            labelFor={(option) => t(SORT_KEYS[option])}
            disabled={(option) => filters.lane === "unpriced" && option === "multiple"}
            onChange={(option) => change({ sort: option })}
          />
        </div>
        <p className="text-xs text-muted-foreground" data-testid="mercari-lane-hint">
          {t(LANE_HINT_KEYS[filters.lane])}
          {filters.lane === "unpriced" ? ` ${t("mercariLeads.sortUnpricedNote")}` : ""}
        </p>
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
