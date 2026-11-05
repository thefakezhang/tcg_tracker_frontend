/**
 * The Buybacks tab's data: every Twitter buyback source, how fresh it is, and
 * its latest buylist (backend #2392, migration 000628).
 *
 * The backend's administrator-only RPCs `twitter_buyback_sources` and
 * `twitter_buyback_buylist` do all the deciding: which tweets count, the
 * freshness bands, the one row per card and grade, the identical quote posted
 * by two accounts, and the verified price. This module validates their
 * documents (fail closed: a malformed field rejects the response rather than
 * rendering a guess), loads them through the private routes, and holds the
 * pure filtering, sorting and crop arithmetic the view uses.
 */

import { pokemonVariantLabel } from "@/lib/pokemon-variant";

export type BuybackFreshness = "fresh" | "aging" | "expired";
export const BUYBACK_FRESHNESS: readonly BuybackFreshness[] = ["fresh", "aging", "expired"];

export type BuybackPolling = {
  account: string;
  /** active, paused, suspended_account or disabled_config (buyer_polling_state). */
  status: string;
  last_polled_at: string | null;
  next_poll_at: string | null;
  consecutive_failures: number;
};

export type BuybackSheetCounts = {
  cells: number;
  auto_approved: number;
  approved: number;
  /** pending and needs_review. */
  pending: number;
  rejected: number;
  expired: number;
  /** A sealed product read on a singles sheet. */
  misclassified: number;
};

export type BuybackAutoAccept = {
  configured: boolean;
  enabled: boolean;
  /** Null without a configuration or an imported revision. */
  fingerprint_current: boolean | null;
  stale_fingerprint: boolean;
  used_today: number;
  daily_cap: number | null;
  per_run_cap: number | null;
};

export type BuybackSource = {
  source: string;
  accounts: string[];
  latest_tweet: {
    tweet_id: string;
    tweet_url: string;
    account: string;
    tweeted_at: string;
    read_at: string | null;
  };
  freshness: BuybackFreshness;
  tweets_24h: number;
  tweets_72h: number;
  latest_sheet: BuybackSheetCounts;
  buylist: { cards: number; live_cards: number; live_bids: number };
  polling: BuybackPolling[];
  auto_accept: BuybackAutoAccept;
};

export type BuybackOverview = {
  generated_at: string;
  fresh_hours: number;
  expiry_hours: number;
  cap_day_started_at: string;
  auto_accept: { global_enabled: boolean; global_daily_cap: number | null; global_used_today: number };
  sources: BuybackSource[];
};

export type BuybackTweet = {
  tweet_id: string;
  tweet_url: string;
  account: string;
  tweeted_at: string;
};

export type BuybackBox = { x0: number; y0: number; x1: number; y1: number };

export type BuybackSheet = {
  image_url: string;
  width: number;
  height: number;
  card: BuybackBox | null;
  price: BuybackBox | null;
};

export type BuybackGrade = "raw" | "psa_10";
export const BUYBACK_GRADES: readonly BuybackGrade[] = ["raw", "psa_10"];

export type BuybackStatus = "auto_approved" | "approved" | "pending" | "needs_review" | "expired";
const BUYBACK_STATUSES: readonly BuybackStatus[] = ["auto_approved", "approved", "pending", "needs_review", "expired"];

export type BuybackCard = {
  card_id: number;
  name: string;
  english_name: string | null;
  set_code: string;
  set_name: string | null;
  set_english_name: string | null;
  card_number: string | null;
  edition: string | null;
  foil_treatment: string | null;
  misc_info: string | null;
};

export type BuybackRow = {
  card: BuybackCard;
  grade: BuybackGrade;
  status: BuybackStatus;
  verified: boolean;
  /** The verified bid, or the read price while in review. */
  price_jpy: number;
  read_price_jpy: number;
  quoted_at: string;
  first_quoted_at: string;
  freshness: BuybackFreshness;
  /** Every tweet that posted this identical quote, newest first. */
  tweets: BuybackTweet[];
  sheet: BuybackSheet | null;
};

export type BuybackBuylist = {
  source: string;
  known: boolean;
  generated_at: string;
  latest_tweet_at: string | null;
  window_started_at: string | null;
  rows: BuybackRow[];
};

/** A refused request; `status` is the HTTP status the route answered. */
export class BuybackRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BuybackRequestError";
    this.status = status;
  }
}

function fail(field: string): never {
  throw new Error(`Invalid buyback field: ${field}`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) fail(field);
  return value as Record<string, unknown>;
}

function list(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail(field);
  return value;
}

function count(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) fail(field);
  return Number(value);
}

function optionalCount(value: unknown, field: string): number | null {
  return value == null ? null : count(value, field);
}

function flag(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail(field);
  return value;
}

function optionalFlag(value: unknown, field: string): boolean | null {
  return value == null ? null : flag(value, field);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(field);
  return value;
}

function optionalText(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") fail(field);
  return value.trim() === "" ? null : value;
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) fail(field);
  return value;
}

function optionalTimestamp(value: unknown, field: string): string | null {
  return value == null ? null : timestamp(value, field);
}

function httpURL(value: unknown, field: string): string {
  const raw = text(value, field);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(field);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") fail(field);
  return raw;
}

function freshness(value: unknown, field: string): BuybackFreshness {
  if (!BUYBACK_FRESHNESS.includes(value as BuybackFreshness)) fail(field);
  return value as BuybackFreshness;
}

function parsePolling(value: unknown, field: string): BuybackPolling {
  const row = record(value, field);
  return {
    account: text(row.account, `${field}.account`),
    status: text(row.status, `${field}.status`),
    last_polled_at: optionalTimestamp(row.last_polled_at, `${field}.last_polled_at`),
    next_poll_at: optionalTimestamp(row.next_poll_at, `${field}.next_poll_at`),
    consecutive_failures: count(row.consecutive_failures, `${field}.consecutive_failures`),
  };
}

function parseSource(value: unknown, index: number): BuybackSource {
  const row = record(value, `sources[${index}]`);
  const source = text(row.source, `sources[${index}].source`);
  const at = (name: string) => `${source}.${name}`;
  const latest = record(row.latest_tweet, at("latest_tweet"));
  const sheet = record(row.latest_sheet, at("latest_sheet"));
  const buylist = record(row.buylist, at("buylist"));
  const autoAccept = record(row.auto_accept, at("auto_accept"));
  const cells = count(sheet.cells, at("latest_sheet.cells"));
  const counts: BuybackSheetCounts = {
    cells,
    auto_approved: count(sheet.auto_approved, at("latest_sheet.auto_approved")),
    approved: count(sheet.approved, at("latest_sheet.approved")),
    pending: count(sheet.pending, at("latest_sheet.pending")),
    rejected: count(sheet.rejected, at("latest_sheet.rejected")),
    expired: count(sheet.expired, at("latest_sheet.expired")),
    misclassified: count(sheet.misclassified, at("latest_sheet.misclassified")),
  };
  const parts = counts.auto_approved + counts.approved + counts.pending + counts.rejected
    + counts.expired + counts.misclassified;
  if (parts !== cells) fail(at("latest_sheet"));
  const cards = count(buylist.cards, at("buylist.cards"));
  const liveCards = count(buylist.live_cards, at("buylist.live_cards"));
  const liveBids = count(buylist.live_bids, at("buylist.live_bids"));
  if (liveCards > cards || liveBids > liveCards) fail(at("buylist"));
  return {
    source,
    accounts: list(row.accounts, at("accounts")).map((account, i) => text(account, at(`accounts[${i}]`))),
    latest_tweet: {
      tweet_id: text(latest.tweet_id, at("latest_tweet.tweet_id")),
      tweet_url: httpURL(latest.tweet_url, at("latest_tweet.tweet_url")),
      account: text(latest.account, at("latest_tweet.account")),
      tweeted_at: timestamp(latest.tweeted_at, at("latest_tweet.tweeted_at")),
      read_at: optionalTimestamp(latest.read_at, at("latest_tweet.read_at")),
    },
    freshness: freshness(row.freshness, at("freshness")),
    tweets_24h: count(row.tweets_24h, at("tweets_24h")),
    tweets_72h: count(row.tweets_72h, at("tweets_72h")),
    latest_sheet: counts,
    buylist: { cards, live_cards: liveCards, live_bids: liveBids },
    polling: list(row.polling, at("polling")).map((entry, i) => parsePolling(entry, at(`polling[${i}]`))),
    auto_accept: {
      configured: flag(autoAccept.configured, at("auto_accept.configured")),
      enabled: flag(autoAccept.enabled, at("auto_accept.enabled")),
      fingerprint_current: optionalFlag(autoAccept.fingerprint_current, at("auto_accept.fingerprint_current")),
      stale_fingerprint: flag(autoAccept.stale_fingerprint, at("auto_accept.stale_fingerprint")),
      used_today: count(autoAccept.used_today, at("auto_accept.used_today")),
      daily_cap: optionalCount(autoAccept.daily_cap, at("auto_accept.daily_cap")),
      per_run_cap: optionalCount(autoAccept.per_run_cap, at("auto_accept.per_run_cap")),
    },
  };
}

/** The overview RPC's document, validated; sources keep the backend's order (latest tweet first). */
export function parseBuybackOverview(value: unknown): BuybackOverview {
  const body = record(value, "overview");
  const autoAccept = record(body.auto_accept, "auto_accept");
  return {
    generated_at: timestamp(body.generated_at, "generated_at"),
    fresh_hours: count(body.fresh_hours, "fresh_hours"),
    expiry_hours: count(body.expiry_hours, "expiry_hours"),
    cap_day_started_at: timestamp(body.cap_day_started_at, "cap_day_started_at"),
    auto_accept: {
      global_enabled: flag(autoAccept.global_enabled, "auto_accept.global_enabled"),
      global_daily_cap: optionalCount(autoAccept.global_daily_cap, "auto_accept.global_daily_cap"),
      global_used_today: count(autoAccept.global_used_today, "auto_accept.global_used_today"),
    },
    sources: list(body.sources, "sources").map(parseSource),
  };
}

function box(value: unknown, field: string, width: number, height: number): BuybackBox | null {
  if (value == null) return null;
  const raw = record(value, field);
  const numbers = [raw.x0, raw.y0, raw.x1, raw.y1];
  if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n))) fail(field);
  const [x0, y0, x1, y1] = numbers as number[];
  // A box outside the image or with no area cannot be drawn; it is left out
  // rather than rejecting the row, because the quote itself is still good.
  if (x1 <= x0 || y1 <= y0 || x0 < 0 || y0 < 0 || x1 > width || y1 > height) return null;
  return { x0, y0, x1, y1 };
}

function parseSheet(value: unknown, field: string): BuybackSheet | null {
  if (value == null) return null;
  const raw = record(value, field);
  if (raw.width == null || raw.height == null) return null;
  const width = count(raw.width, `${field}.width`);
  const height = count(raw.height, `${field}.height`);
  if (width < 1 || height < 1) fail(`${field}.size`);
  const imageURL = httpURL(raw.image_url, `${field}.image_url`);
  const geometry = raw.geometry == null ? null : record(raw.geometry, `${field}.geometry`);
  // The candidate table also holds legacy flat boxes: the box is the card.
  const flat = geometry !== null && "x0" in geometry;
  return {
    image_url: imageURL,
    width,
    height,
    card: geometry === null ? null : box(flat ? geometry : geometry.card, `${field}.card`, width, height),
    price: geometry === null || flat ? null : box(geometry.price, `${field}.price`, width, height),
  };
}

function parseRow(value: unknown, index: number): BuybackRow {
  const row = record(value, `rows[${index}]`);
  const at = (name: string) => `rows[${index}].${name}`;
  const card = record(row.card, at("card"));
  const grade = row.grade;
  if (!BUYBACK_GRADES.includes(grade as BuybackGrade)) fail(at("grade"));
  const status = row.status;
  if (!BUYBACK_STATUSES.includes(status as BuybackStatus)) fail(at("status"));
  const verified = flag(row.verified, at("verified"));
  if (verified !== (status === "auto_approved" || status === "approved")) fail(at("verified"));
  const price = count(row.price_jpy, at("price_jpy"));
  const read = count(row.read_price_jpy, at("read_price_jpy"));
  // An in-review quote is its read price; only a verification can change it.
  if (!verified && price !== read) fail(at("price_jpy"));
  const tweets = list(row.tweets, at("tweets")).map((entry, i) => {
    const tweet = record(entry, at(`tweets[${i}]`));
    return {
      tweet_id: text(tweet.tweet_id, at(`tweets[${i}].tweet_id`)),
      tweet_url: httpURL(tweet.tweet_url, at(`tweets[${i}].tweet_url`)),
      account: text(tweet.account, at(`tweets[${i}].account`)),
      tweeted_at: timestamp(tweet.tweeted_at, at(`tweets[${i}].tweeted_at`)),
    };
  });
  if (tweets.length < 1) fail(at("tweets"));
  return {
    card: {
      card_id: count(card.card_id, at("card.card_id")),
      name: text(card.name, at("card.name")),
      english_name: optionalText(card.english_name, at("card.english_name")),
      set_code: text(card.set_code, at("card.set_code")),
      set_name: optionalText(card.set_name, at("card.set_name")),
      set_english_name: optionalText(card.set_english_name, at("card.set_english_name")),
      card_number: knownText(optionalText(card.card_number, at("card.card_number"))),
      edition: optionalText(card.edition, at("card.edition")),
      foil_treatment: optionalText(card.foil_treatment, at("card.foil_treatment")),
      misc_info: knownText(optionalText(card.misc_info, at("card.misc_info"))),
    },
    grade: grade as BuybackGrade,
    status: status as BuybackStatus,
    verified,
    price_jpy: price,
    read_price_jpy: read,
    quoted_at: timestamp(row.quoted_at, at("quoted_at")),
    first_quoted_at: timestamp(row.first_quoted_at, at("first_quoted_at")),
    freshness: freshness(row.freshness, at("freshness")),
    tweets,
    sheet: parseSheet(row.sheet, at("sheet")),
  };
}

// "UNKNOWN" is the catalog's null for card_number and misc_info; never shown.
function knownText(value: string | null): string | null {
  return value === null || value.toUpperCase() === "UNKNOWN" ? null : value;
}

/** The buylist RPC's document, validated; rows keep the backend's order (newest quote first). */
export function parseBuybackBuylist(value: unknown): BuybackBuylist {
  const body = record(value, "buylist");
  return {
    source: text(body.source, "source"),
    known: flag(body.known, "known"),
    generated_at: timestamp(body.generated_at, "generated_at"),
    latest_tweet_at: optionalTimestamp(body.latest_tweet_at, "latest_tweet_at"),
    window_started_at: optionalTimestamp(body.window_started_at, "window_started_at"),
    rows: list(body.rows, "rows").map(parseRow),
  };
}

/** Resolves null when the backend migration is not applied yet (the route's 501). */
export type BuybackOverviewLoader = () => Promise<BuybackOverview | null>;
export type BuybackBuylistLoader = (source: string) => Promise<BuybackBuylist | null>;

async function buybackResponse<T>(
  response: Response,
  key: string,
  parse: (value: unknown) => T,
): Promise<T | null> {
  const body = await response.json().catch(() => null) as unknown;
  if (response.status === 501) return null;
  if (!response.ok) {
    const message = body != null && typeof body === "object" && "error" in body
      && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new BuybackRequestError(response.status, message);
  }
  if (body == null || typeof body !== "object" || !(key in body)) {
    throw new Error(`Invalid buyback ${key} response`);
  }
  return parse((body as Record<string, unknown>)[key]);
}

export const loadBuybackOverview: BuybackOverviewLoader = async () => {
  const response = await fetch("/api/twitter-buybacks", {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  return buybackResponse(response, "overview", parseBuybackOverview);
};

export const loadBuybackBuylist: BuybackBuylistLoader = async (source) => {
  const response = await fetch(`/api/twitter-buybacks/buylist?${new URLSearchParams({ source })}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  return buybackResponse(response, "buylist", parseBuybackBuylist);
};

// --- Pure view logic -------------------------------------------------------

export type BuybackGradeFilter = "all" | BuybackGrade;
export type BuybackVerificationFilter = "all" | "verified" | "review";
export type BuybackSort = "newest" | "price_desc" | "price_asc";
export const BUYBACK_SORTS: readonly BuybackSort[] = ["newest", "price_desc", "price_asc"];

export type BuybackFilters = {
  grade: BuybackGradeFilter;
  verification: BuybackVerificationFilter;
  query: string;
};

export const DEFAULT_BUYBACK_FILTERS: BuybackFilters = { grade: "all", verification: "all", query: "" };

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

/**
 * Card or set search: every word must appear in the card's name (Japanese or
 * English), set code or name, card number, or printing.
 */
export function matchesBuybackQuery(row: BuybackRow, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const card = row.card;
  const haystack = normalize([
    card.name,
    card.english_name,
    card.set_code,
    card.set_name,
    card.set_english_name,
    card.card_number,
    buybackPrintingLabel(card),
  ].filter(Boolean).join(" "));
  return words.every((word) => haystack.includes(word));
}

export function filterBuybackRows(rows: readonly BuybackRow[], filters: BuybackFilters): BuybackRow[] {
  return rows.filter((row) => (filters.grade === "all" || row.grade === filters.grade)
    && (filters.verification === "all" || row.verified === (filters.verification === "verified"))
    && matchesBuybackQuery(row, filters.query));
}

/** Newest quote first, or by price; ties keep the newest quote first, then the card. */
export function sortBuybackRows(rows: readonly BuybackRow[], sort: BuybackSort): BuybackRow[] {
  const newest = (a: BuybackRow, b: BuybackRow) => Date.parse(b.quoted_at) - Date.parse(a.quoted_at)
    || a.card.card_id - b.card.card_id
    || a.grade.localeCompare(b.grade);
  const sorted = [...rows];
  if (sort === "price_desc") sorted.sort((a, b) => b.price_jpy - a.price_jpy || newest(a, b));
  else if (sort === "price_asc") sorted.sort((a, b) => a.price_jpy - b.price_jpy || newest(a, b));
  else sorted.sort(newest);
  return sorted;
}

/** The printing label from the typed axes and the residue, as the catalog surfaces show it. */
export function buybackPrintingLabel(card: BuybackCard): string | null {
  return pokemonVariantLabel({
    misc_info: card.misc_info,
    edition: card.edition,
    foil_treatment: card.foil_treatment,
  });
}

export function matchesSourceQuery(source: BuybackSource, query: string): boolean {
  const needle = normalize(query.trim().replace(/^@/, ""));
  if (needle === "") return true;
  return [source.source, ...source.accounts].some((name) => normalize(name).includes(needle));
}

export function countByFreshness(sources: readonly BuybackSource[]): Record<BuybackFreshness, number> {
  const counts: Record<BuybackFreshness, number> = { fresh: 0, aging: 0, expired: 0 };
  for (const source of sources) counts[source.freshness] += 1;
  return counts;
}

/**
 * When the poller last checked the source: the latest check of an active
 * account, else of any account. Null when it never has.
 */
export function lastChecked(source: BuybackSource): string | null {
  const latest = (rows: BuybackPolling[]) => rows
    .map((row) => row.last_polled_at)
    .filter((value): value is string => value !== null)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  return latest(source.polling.filter((row) => row.status === "active")) ?? latest(source.polling);
}

/** Accounts the poller is not reading normally: not active, or failing. */
export function pollingProblems(source: BuybackSource): BuybackPolling[] {
  return source.polling.filter((row) => row.status !== "active" || row.consecutive_failures > 0);
}

/**
 * How to show one box of a sheet at a display size: the image is drawn at its
 * natural size, shifted so the box's corner is at the origin, and scaled to
 * fit the box inside the display rectangle while keeping its aspect.
 */
export function cropLayout(sheetBox: BuybackBox, maxWidth: number, maxHeight: number) {
  const width = Math.max(1, sheetBox.x1 - sheetBox.x0);
  const height = Math.max(1, sheetBox.y1 - sheetBox.y0);
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return {
    frameWidth: Math.round(width * scale),
    frameHeight: Math.round(height * scale),
    imageWidth: width,
    imageHeight: height,
    offsetX: sheetBox.x0,
    offsetY: sheetBox.y0,
    scale,
  };
}
