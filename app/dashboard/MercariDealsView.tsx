"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EyeOff, ExternalLink, Info, LoaderCircle, RefreshCw, RotateCcw, Search } from "lucide-react";

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
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { formatJpy, formatUsd } from "@/lib/money";
import { formatRoiPct, roiToneClass } from "./theoretical-roi";
import { classifyQueryError } from "./use-query";

export type MercariHolder = "raw" | "graded";
export type MercariLane = "strict" | "candidate";
export type MercariItemAction = "dismissed" | "recheck_requested";
export type MercariSellerConditionID = "1" | "2" | "3" | "4" | "5" | "6";

export type MercariDeal = {
  external_item_id: string;
  source_item_type: "mercari" | "beyond";
  canonical_url: string;
  source_search_url: string;
  evidence_lane: MercariLane;
  confidence_tier: string;
  reason_codes: string[];
  sanitized_title: string;
  current_card_uid: string;
  regional_name: string;
  english_name: string | null;
  set_code: string;
  card_number: string | null;
  misc_info: string | null;
  image_url: string | null;
  holder_kind: MercariHolder;
  psa_grade: number;
  condition_display_name: string;
  seller_condition_id: MercariSellerConditionID;
  ask_jpy: number;
  observed_at: string;
  freshness_status: "fresh" | "aging" | "stale";
  freshness_age_hours: number | null;
  jpy_to_usd_rate: number | null;
  conservative_exit_jpy: number | null;
  conservative_exit_basis: string;
  economics_status: string;
  net_profit_usd: number | null;
  roi: number | null;
  latest_item_action: MercariItemAction | null;
  latest_item_action_reason: string | null;
  latest_item_action_at: string | null;
};

export type MercariDealFilters = {
  holder: "" | MercariHolder;
  lane: "" | MercariLane;
  includeDismissed: boolean;
};

export type MercariDealCursor = {
  before: string;
  before_key: string;
};

export type MercariDealsPage = {
  deals: MercariDeal[];
  nextCursor: MercariDealCursor | null;
};

export type MercariDealsLoader = (
  filters: MercariDealFilters,
  cursor: MercariDealCursor | null,
) => Promise<MercariDealsPage>;

export type MercariDealActor = (
  externalItemId: string,
  action: MercariItemAction,
  reason: string,
) => Promise<void>;

export const DEFAULT_FILTERS: MercariDealFilters = { holder: "", lane: "", includeDismissed: false };

export class MercariDealsRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "MercariDealsRequestError";
    this.status = status;
  }
}

const SAFE_ITEM_ID = /^(m[0-9]{9,11}|[A-Za-z0-9]{20,32})$/;
const SELLER_CONDITIONS = new Set(["1", "2", "3", "4", "5", "6"]);

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid Mercari deal field: ${field}`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(`Invalid Mercari deal field: ${field}`);
  return value;
}

// PostgREST serializes bigint and numeric as JSON numbers, but a numeric can
// arrive as a string through some clients; accept both and refuse anything else.
function optionalNumber(value: unknown, field: string): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) throw new Error(`Invalid Mercari deal number: ${field}`);
  return parsed;
}

function requiredNumber(value: unknown, field: string): number {
  const parsed = optionalNumber(value, field);
  if (parsed === null) throw new Error(`Invalid Mercari deal number: ${field}`);
  return parsed;
}

function mercariURL(value: unknown, field: string, prefix: string): string {
  const parsed = requiredString(value, field);
  let url: URL;
  try {
    url = new URL(parsed);
  } catch {
    throw new Error(`Invalid Mercari deal URL: ${field}`);
  }
  if (url.protocol !== "https:" || url.host !== "jp.mercari.com" || !parsed.startsWith(prefix)) {
    throw new Error(`Invalid Mercari deal URL: ${field}`);
  }
  return parsed;
}

function imageURL(value: unknown): string | null {
  if (value == null) return null;
  const parsed = requiredString(value, "image_url");
  let url: URL;
  try {
    url = new URL(parsed, "http://fixture.local");
  } catch {
    throw new Error("Invalid Mercari deal URL: image_url");
  }
  if (!["http:", "https:", "data:"].includes(url.protocol)) {
    throw new Error("Invalid Mercari deal URL scheme: image_url");
  }
  return parsed;
}

export function parseMercariDeals(value: unknown): MercariDeal[] {
  if (!Array.isArray(value)) throw new Error("Invalid Mercari deals response");
  return value.map((raw, index) => {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Invalid Mercari deal row: ${index}`);
    }
    const row = raw as Record<string, unknown>;
    const externalItemId = requiredString(row.external_item_id, "external_item_id");
    if (!SAFE_ITEM_ID.test(externalItemId)) {
      throw new Error(`Invalid Mercari deal id: ${index}`);
    }
    const sourceItemType = requiredString(row.source_item_type, "source_item_type");
    if (sourceItemType !== "mercari" && sourceItemType !== "beyond") {
      throw new Error(`Invalid Mercari deal source: ${index}`);
    }
    const lane = requiredString(row.evidence_lane, "evidence_lane");
    if (lane !== "strict" && lane !== "candidate") {
      throw new Error(`Invalid Mercari deal lane: ${index}`);
    }
    const holder = requiredString(row.holder_kind, "holder_kind");
    if (holder !== "raw" && holder !== "graded") {
      throw new Error(`Invalid Mercari deal holder: ${index}`);
    }
    const grade = requiredNumber(row.psa_grade, "psa_grade");
    if ((holder === "raw" && grade !== 0) || (holder === "graded" && (grade < 1 || grade > 10))) {
      throw new Error(`Invalid Mercari deal grade: ${index}`);
    }
    const sellerCondition = requiredString(row.seller_condition_id, "seller_condition_id");
    if (!SELLER_CONDITIONS.has(sellerCondition)) {
      throw new Error(`Invalid Mercari deal seller condition: ${index}`);
    }
    const freshness = requiredString(row.freshness_status, "freshness_status");
    if (freshness !== "fresh" && freshness !== "aging" && freshness !== "stale") {
      throw new Error(`Invalid Mercari deal freshness: ${index}`);
    }
    const action = optionalString(row.latest_item_action, "latest_item_action");
    if (action !== null && action !== "dismissed" && action !== "recheck_requested") {
      throw new Error(`Invalid Mercari deal action: ${index}`);
    }
    if (!Array.isArray(row.reason_codes) || !row.reason_codes.every((code) => typeof code === "string")) {
      throw new Error(`Invalid Mercari deal reasons: ${index}`);
    }
    const observedAt = requiredString(row.observed_at, "observed_at");
    if (Number.isNaN(Date.parse(observedAt))) {
      throw new Error(`Invalid Mercari deal timestamp: ${index}`);
    }
    const ask = requiredNumber(row.ask_jpy, "ask_jpy");
    if (ask <= 0) throw new Error(`Invalid Mercari deal ask: ${index}`);
    return {
      external_item_id: externalItemId,
      source_item_type: sourceItemType,
      canonical_url: mercariURL(
        row.canonical_url,
        "canonical_url",
        sourceItemType === "mercari" ? "https://jp.mercari.com/item/" : "https://jp.mercari.com/shops/product/",
      ),
      source_search_url: mercariURL(row.source_search_url, "source_search_url", "https://jp.mercari.com/search?"),
      evidence_lane: lane,
      confidence_tier: requiredString(row.confidence_tier, "confidence_tier"),
      reason_codes: row.reason_codes as string[],
      sanitized_title: requiredString(row.sanitized_title, "sanitized_title"),
      current_card_uid: requiredString(row.current_card_uid, "current_card_uid"),
      regional_name: requiredString(row.regional_name, "regional_name"),
      english_name: optionalString(row.english_name, "english_name"),
      set_code: requiredString(row.set_code, "set_code"),
      card_number: optionalString(row.card_number, "card_number"),
      misc_info: optionalString(row.misc_info, "misc_info"),
      image_url: imageURL(row.image_url),
      holder_kind: holder,
      psa_grade: grade,
      condition_display_name: requiredString(row.condition_display_name, "condition_display_name"),
      seller_condition_id: sellerCondition as MercariSellerConditionID,
      ask_jpy: ask,
      observed_at: observedAt,
      freshness_status: freshness,
      freshness_age_hours: optionalNumber(row.freshness_age_hours, "freshness_age_hours"),
      jpy_to_usd_rate: optionalNumber(row.jpy_to_usd_rate, "jpy_to_usd_rate"),
      conservative_exit_jpy: optionalNumber(row.conservative_exit_jpy, "conservative_exit_jpy"),
      conservative_exit_basis: requiredString(row.conservative_exit_basis, "conservative_exit_basis"),
      economics_status: requiredString(row.economics_status, "economics_status"),
      net_profit_usd: optionalNumber(row.net_profit_usd, "net_profit_usd"),
      roi: optionalNumber(row.roi, "roi"),
      latest_item_action: action,
      latest_item_action_reason: optionalString(row.latest_item_action_reason, "latest_item_action_reason"),
      latest_item_action_at: optionalString(row.latest_item_action_at, "latest_item_action_at"),
    };
  });
}

function parseCursor(value: unknown): MercariDealCursor | null {
  if (value === null) return null;
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Mercari deals cursor");
  }
  const raw = value as Record<string, unknown>;
  const before = requiredString(raw.before, "next_cursor.before");
  const beforeKey = requiredString(raw.before_key, "next_cursor.before_key");
  if (Number.isNaN(Date.parse(before)) || !SAFE_ITEM_ID.test(beforeKey)) {
    throw new Error("Invalid Mercari deals cursor");
  }
  return { before, before_key: beforeKey };
}

async function readBody(response: Response): Promise<unknown> {
  return response.json().catch(() => null) as Promise<unknown>;
}

function errorMessage(body: unknown, status: number): string {
  return body != null && typeof body === "object" && "error" in body && typeof body.error === "string"
    ? body.error
    : `HTTP ${status}`;
}

export const loadMercariDeals: MercariDealsLoader = async (filters, cursor) => {
  const query = new URLSearchParams({ limit: "100" });
  if (filters.holder) query.set("holder", filters.holder);
  if (filters.lane) query.set("lane", filters.lane);
  if (filters.includeDismissed) query.set("include_dismissed", "1");
  if (cursor) {
    query.set("before", cursor.before);
    query.set("before_key", cursor.before_key);
  }
  const response = await fetch(`/api/mercari-deals?${query}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new MercariDealsRequestError(response.status, errorMessage(body, response.status));
  }
  if (body == null || typeof body !== "object" || !("deals" in body) || !("next_cursor" in body)) {
    throw new Error("Invalid Mercari deals response");
  }
  return {
    deals: parseMercariDeals(body.deals),
    nextCursor: parseCursor(body.next_cursor),
  };
};

export const recordMercariDealAction: MercariDealActor = async (externalItemId, action, reason) => {
  const response = await fetch("/api/mercari-deals/action", {
    method: "POST",
    cache: "no-store",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ external_item_id: externalItemId, action, reason }),
  });
  if (!response.ok) {
    const body = await readBody(response);
    throw new MercariDealsRequestError(response.status, errorMessage(body, response.status));
  }
};

export function previewURL(sourceURL: string): string {
  if (sourceURL.startsWith("data:") || sourceURL.startsWith("/")) return sourceURL;
  return `/api/proxy-image?url=${encodeURIComponent(sourceURL)}`;
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

function isUnknown(value: string | null): boolean {
  return value === null || value.trim() === "" || value === "UNKNOWN";
}

export const SELLER_CONDITION_KEYS: Record<MercariSellerConditionID, TranslationKey> = {
  "1": "mercari.sellerCondition.1",
  "2": "mercari.sellerCondition.2",
  "3": "mercari.sellerCondition.3",
  "4": "mercari.sellerCondition.4",
  "5": "mercari.sellerCondition.5",
  "6": "mercari.sellerCondition.6",
};

const EXIT_BASIS_KEYS: Record<string, TranslationKey> = {
  p25_floored_by_jp_bid: "mercari.exitBasis.p25_floored_by_jp_bid",
  p25: "mercari.exitBasis.p25",
  jp_bid_floor: "mercari.exitBasis.jp_bid_floor",
};

const ECONOMICS_STATUS_KEYS: Record<string, TranslationKey> = {
  missing_fx_rate: "mercari.economicsStatus.missing_fx_rate",
  missing_exit_profile: "mercari.economicsStatus.missing_exit_profile",
  missing_exit_reference: "mercari.economicsStatus.missing_exit_reference",
  missing_exit_horizon: "mercari.economicsStatus.missing_exit_horizon",
};

const FRESHNESS_KEYS: Record<MercariDeal["freshness_status"], TranslationKey> = {
  fresh: "mercari.fresh",
  aging: "mercari.aging",
  stale: "mercari.stale",
};

const FRESHNESS_CLASSES: Record<MercariDeal["freshness_status"], string> = {
  fresh: "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  aging: "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  stale: "border-red-500/50 bg-red-500/10 text-red-800 dark:text-red-200",
};

export function LoadFailure({
  error,
  title,
  onRetry,
}: {
  error: Error;
  title: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const kind = classifyQueryError(error);

  if (kind === "session-expired") {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4" role="alert">
        <p className="font-medium">{t("mercari.sessionExpiredTitle")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("mercari.sessionExpiredBody")}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <a
            href="/login"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border bg-background px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
          >
            {t("mercari.signInAgain")}
          </a>
          <Button className="min-h-11 sm:min-h-8" variant="outline" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            {t("mercari.continueAfterSignIn")}
          </Button>
        </div>
      </div>
    );
  }

  if (kind === "forbidden") {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4" role="alert">
        <p className="font-medium">{t("mercari.operatorRequiredTitle")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("mercari.operatorRequiredBody")}</p>
        <a
          href="/login"
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex min-h-11 items-center justify-center rounded-lg border bg-background px-4 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
        >
          {t("mercari.signInAsOperator")}
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4" role="alert">
      <p className="font-medium">{title}</p>
      <p className="mt-1 break-words text-sm text-muted-foreground">{error.message}</p>
      <Button className="mt-3 min-h-11 sm:min-h-8" variant="outline" onClick={onRetry}>
        <RefreshCw aria-hidden="true" />
        {t("mercari.retry")}
      </Button>
    </div>
  );
}

function DealActions({
  deal,
  actor,
  onActed,
}: {
  deal: MercariDeal;
  actor: MercariDealActor;
  onActed: (action: MercariItemAction, reason: string) => void;
}) {
  const { t } = useTranslation();
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<MercariItemAction | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const act = async (action: MercariItemAction, actionReason: string) => {
    setPending(action);
    setError(null);
    try {
      await actor(deal.external_item_id, action, actionReason);
      onActed(action, actionReason);
      setDismissing(false);
      setReason("");
    } catch (reasonForFailure) {
      setError(asError(reasonForFailure));
    } finally {
      setPending(null);
    }
  };

  const reasonId = `mercari-dismiss-reason-${deal.external_item_id}`;
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
              placeholder={t("mercari.dismissReasonPlaceholder")}
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
          {deal.latest_item_action !== "dismissed" && (
            <Button type="button" className="h-11 sm:h-8" variant="outline" onClick={() => setDismissing(true)}>
              <EyeOff className="size-4" aria-hidden="true" />
              {t("mercari.dismiss")}
            </Button>
          )}
          {deal.latest_item_action !== "recheck_requested" && (
            <Button type="button" className="h-11 sm:h-8" variant="outline" disabled={pending !== null} onClick={() => void act("recheck_requested", "")}>
              {pending === "recheck_requested" ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
              {t("mercari.recheck")}
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

export default function MercariDealsView({
  loader = loadMercariDeals,
  actor = recordMercariDealAction,
}: {
  loader?: MercariDealsLoader;
  actor?: MercariDealActor;
}) {
  const { t, language } = useTranslation();
  const [draft, setDraft] = useState<MercariDealFilters>(DEFAULT_FILTERS);
  const [active, setActive] = useState<MercariDealFilters>(DEFAULT_FILTERS);
  const [deals, setDeals] = useState<MercariDeal[]>([]);
  const [nextCursor, setNextCursor] = useState<MercariDealCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);
  const requestGeneration = useRef(0);

  const load = useCallback(async (
    filters: MercariDealFilters,
    cursor: MercariDealCursor | null,
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
      setDeals([]);
      setNextCursor(null);
    }
    try {
      const page = await loader(filters, cursor);
      if (requestGeneration.current !== generation) return;
      setDeals((current) => {
        if (!append) return page.deals;
        const seen = new Set(current.map((deal) => deal.external_item_id));
        return [
          ...current,
          ...page.deals.filter((deal) => {
            if (seen.has(deal.external_item_id)) return false;
            seen.add(deal.external_item_id);
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
    void load(active, null, false);
  }, [active, load]);

  // Listings live in Japan, so the observation time is pinned to JST like the
  // Arrivals tab rather than rendered in the viewer's local zone.
  const dateTime = useCallback((value: string | null) => {
    if (value === null) return t("mercari.unknownTime");
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return t("mercari.unknownTime");
    return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Tokyo",
    }).format(parsed);
  }, [language, t]);

  const markActed = useCallback((externalItemId: string, action: MercariItemAction, reason: string) => {
    const actedAt = new Date().toISOString();
    setDeals((current) => current.map((deal) => (
      deal.external_item_id === externalItemId
        ? { ...deal, latest_item_action: action, latest_item_action_reason: reason || null, latest_item_action_at: actedAt }
        : deal
    )));
  }, []);

  const cardName = (deal: MercariDeal) => {
    const number = isUnknown(deal.card_number) ? "" : ` ${deal.card_number}`;
    return `${deal.regional_name} (${deal.set_code}${number})`;
  };

  return (
    <section className="mx-auto w-full max-w-6xl min-w-0 space-y-4" aria-labelledby="mercari-deals-title">
      <div className="space-y-1">
        <h1 id="mercari-deals-title" className="text-xl font-semibold sm:text-2xl">
          {t("mercari.title")}
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("mercari.subtitle")}
        </p>
      </div>

      <form
        className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:flex-wrap sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const same = draft.holder === active.holder && draft.lane === active.lane
            && draft.includeDismissed === active.includeDismissed;
          if (same) void load(active, null, false);
          else setActive(draft);
        }}
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="mercari-holder-filter">{t("mercari.holderFilter")}</Label>
          <select
            id="mercari-holder-filter"
            className="flex h-11 w-full rounded-md border border-input bg-background px-2 text-sm sm:h-8"
            value={draft.holder}
            onChange={(event) => setDraft({ ...draft, holder: event.target.value as MercariDealFilters["holder"] })}
          >
            <option value="">{t("mercari.holderAll")}</option>
            <option value="graded">{t("mercari.holderGraded")}</option>
            <option value="raw">{t("mercari.holderRaw")}</option>
          </select>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="mercari-lane-filter">{t("mercari.laneFilter")}</Label>
          <select
            id="mercari-lane-filter"
            className="flex h-11 w-full rounded-md border border-input bg-background px-2 text-sm sm:h-8"
            value={draft.lane}
            onChange={(event) => setDraft({ ...draft, lane: event.target.value as MercariDealFilters["lane"] })}
          >
            <option value="">{t("mercari.laneAll")}</option>
            <option value="strict">{t("mercari.laneStrict")}</option>
            <option value="candidate">{t("mercari.laneCandidate")}</option>
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
          <input
            type="checkbox"
            className="size-4"
            checked={draft.includeDismissed}
            onChange={(event) => setDraft({ ...draft, includeDismissed: event.target.checked })}
          />
          {t("mercari.includeDismissed")}
        </label>
        <Button type="submit" className="h-11 w-full sm:h-8 sm:w-auto" disabled={loading}>
          <Search aria-hidden="true" />
          {t("mercari.applyFilter")}
        </Button>
      </form>

      {loading ? (
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          {t("mercari.loading")}
        </div>
      ) : error ? (
        <LoadFailure
          error={error}
          title={t("mercari.errorTitle")}
          onRetry={() => void load(active, null, false)}
        />
      ) : deals.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="font-medium">{t("mercari.emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("mercari.emptyBody")}</p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-4 md:grid-cols-2" data-testid="mercari-deal-list">
          {deals.map((deal) => {
            const askUsd = deal.jpy_to_usd_rate && deal.jpy_to_usd_rate > 0 ? deal.ask_jpy * deal.jpy_to_usd_rate : null;
            const hasEconomics = deal.net_profit_usd !== null && deal.roi !== null;
            const exitBasisKey = EXIT_BASIS_KEYS[deal.conservative_exit_basis];
            const economicsStatusKey = ECONOMICS_STATUS_KEYS[deal.economics_status];
            return (
              <Card key={deal.external_item_id} className="min-w-0" data-testid="mercari-deal-card">
                <CardHeader>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <CardTitle className="min-w-0 break-words">{deal.regional_name}</CardTitle>
                    <Badge variant="outline">
                      {deal.holder_kind === "graded" ? t("mercari.psaGrade", { grade: deal.psa_grade }) : t("mercari.raw")}
                    </Badge>
                    <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200">
                      {deal.evidence_lane === "strict" ? t("mercari.strictOffer") : t("mercari.candidate", { tier: deal.confidence_tier })}
                    </Badge>
                    <Badge variant="outline" className={FRESHNESS_CLASSES[deal.freshness_status]}>
                      {t(FRESHNESS_KEYS[deal.freshness_status])}
                    </Badge>
                    {deal.latest_item_action === "dismissed" && (
                      <Badge variant="outline">{t("mercari.dismissed")}</Badge>
                    )}
                    {deal.latest_item_action === "recheck_requested" && (
                      <Badge variant="outline">{t("mercari.recheckRequested")}</Badge>
                    )}
                  </div>
                  <CardDescription className="space-y-1 break-words">
                    <div>
                      {deal.set_code}
                      {isUnknown(deal.card_number) ? "" : ` ${deal.card_number}`}
                      {isUnknown(deal.misc_info) ? "" : ` · ${deal.misc_info}`}
                      {deal.english_name && deal.english_name !== deal.regional_name ? ` · ${deal.english_name}` : ""}
                    </div>
                    <div>
                      {t("mercari.observed")}: {dateTime(deal.observed_at)}
                      {deal.freshness_age_hours !== null ? ` (${t("mercari.ageHours", { hours: Math.round(deal.freshness_age_hours) })})` : ""}
                    </div>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid min-w-0 grid-cols-[6rem_1fr] gap-3 sm:grid-cols-[8rem_1fr]">
                    <div className="flex aspect-[3/4] min-w-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                      {deal.image_url ? (
                        <img
                          src={previewURL(deal.image_url)}
                          alt={t("mercari.imageAlt", { card: cardName(deal) })}
                          className="h-full w-full object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <Info className="size-5 text-muted-foreground" aria-hidden="true" />
                      )}
                    </div>
                    <dl className="min-w-0 space-y-1 text-sm">
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="text-muted-foreground">{t("mercari.ask")}</dt>
                        <dd className="font-medium">
                          {formatJpy(deal.ask_jpy)}
                          {askUsd !== null ? ` (${formatUsd(askUsd)})` : ""}
                        </dd>
                      </div>
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="text-muted-foreground">{t("mercari.sellerCondition")}</dt>
                        <dd>{t(SELLER_CONDITION_KEYS[deal.seller_condition_id])}</dd>
                      </div>
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="text-muted-foreground">{t("mercari.catalogCondition")}</dt>
                        <dd>{deal.condition_display_name}</dd>
                      </div>
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="text-muted-foreground">{t("mercari.exit")}</dt>
                        <dd>
                          {deal.conservative_exit_jpy !== null
                            ? `${formatJpy(deal.conservative_exit_jpy)}${exitBasisKey ? ` (${t(exitBasisKey)})` : ""}`
                            : t("mercari.exitBasis.missing_exit_reference")}
                        </dd>
                      </div>
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="text-muted-foreground">{t("mercari.economics")}</dt>
                        <dd className={hasEconomics ? `font-medium ${roiToneClass(deal.roi! * 100)}` : ""}>
                          {hasEconomics
                            ? `${formatUsd(deal.net_profit_usd!)} · ${t("mercari.roi")} ${formatRoiPct(deal.roi! * 100)}`
                            : economicsStatusKey
                              ? t(economicsStatusKey)
                              : t("mercari.economicsUnavailable", { status: deal.economics_status })}
                        </dd>
                      </div>
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="text-muted-foreground">{t("mercari.sellerTitle")}</dt>
                        <dd className="break-words">{deal.sanitized_title}</dd>
                      </div>
                    </dl>
                  </div>
                  {deal.reason_codes.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground">{t("mercari.reasons")}:</span>
                      {deal.reason_codes.map((code) => (
                        <code key={code} className="rounded bg-muted px-1.5 py-0.5">{code}</code>
                      ))}
                    </div>
                  )}
                  {deal.latest_item_action === "dismissed" && deal.latest_item_action_reason && (
                    <p className="text-sm text-muted-foreground">
                      {t("mercari.dismissedBecause", { reason: deal.latest_item_action_reason })}
                    </p>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <a
                      href={deal.canonical_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
                    >
                      <ExternalLink className="size-4" aria-hidden="true" />
                      {t("mercari.openListing")}
                    </a>
                    <a
                      href={deal.source_search_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
                    >
                      <Search className="size-4" aria-hidden="true" />
                      {t("mercari.openSearch")}
                    </a>
                  </div>
                  <DealActions
                    deal={deal}
                    actor={actor}
                    onActed={(action, reason) => markActed(deal.external_item_id, action, reason)}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {!loading && !error && deals.length > 0 && (
        <div className="space-y-3">
          {loadMoreError && (
            <LoadFailure
              error={loadMoreError}
              title={t("mercari.moreErrorTitle")}
              onRetry={() => void load(active, nextCursor, true)}
            />
          )}
          {nextCursor && !loadMoreError && (
            <Button
              className="h-11 w-full sm:w-auto"
              variant="outline"
              disabled={loadingMore}
              onClick={() => void load(active, nextCursor, true)}
            >
              {loadingMore ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-4" aria-hidden="true" />
              )}
              {loadingMore ? t("mercari.loadingMore") : t("mercari.loadMore")}
            </Button>
          )}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="note">
            <Info className="size-4" aria-hidden="true" />
            {t("mercari.evidenceNote")}
          </p>
        </div>
      )}
    </section>
  );
}
