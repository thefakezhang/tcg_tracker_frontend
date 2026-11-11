"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  ImageIcon,
  LayoutList,
  LoaderCircle,
  RefreshCw,
  Repeat2,
  Users,
} from "lucide-react";

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
import { REGION_RE } from "@/lib/arrival-region-key";
import { useTranslation } from "@/lib/i18n";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import {
  type ArrivalAccountPost,
  type ArrivalSource,
  accountInRegions,
  accountLabel,
  deriveArrivalSources,
  groupPostsByAccount,
  matchesAccountQuery,
  parseArrivalSources,
  readCollapsedAccounts,
  readGroupByAccount,
  sortArrivalSources,
  sourcesCarryRegions,
  writeCollapsedAccounts,
  writeGroupByAccount,
} from "./arrival-accounts";
import ArrivalRegionFilter, {
  ArrivalRegionReads,
  type RegionReadProgress,
  regionSelectionSummary,
} from "./ArrivalRegionFilter";
import ArrivalRegionPanel from "./ArrivalRegionPanel";
import {
  MAX_POLL_PAGES,
  POLL_INTERVAL_MS,
  POLL_LIMIT_MS,
  type ScrollAnchor,
  captureScrollAnchor,
  mergeFreshPosts,
  restoreScrollAnchor,
} from "./arrival-feed-poll";
import {
  canonicalRegions,
  pendingReadKey,
  regionFilterOptions,
  unknownRegions,
} from "./arrival-region-filter";
import {
  type RegionActionSender,
  type RegionStatusLoader,
  needsReadOnce,
  regionReadState,
} from "./arrival-regions";
import { useArrivalRegionStatus } from "./use-arrival-region-status";
import { decodeTweetText, tweetTextSegments } from "./arrival-text";
import {
  cutoffISO,
  pageExhaustsWindow,
  postsWithinWindow,
  readArrivalWindow,
  windowCutoff,
  windowPagingContinues,
  writeArrivalWindow,
} from "./arrival-window";
import {
  ARRIVALS_REGION_PARAM,
  ARRIVALS_SHOP_PARAM,
  ARRIVALS_WINDOW_PARAM,
  ARRIVAL_WINDOWS,
  type ArrivalWindow,
  DEFAULT_ARRIVAL_WINDOW,
  formatRegionsParam,
  parseRegionsParam,
  parseShopParam,
  parseWindowParam,
  readUrlParam,
  writeUrlParam,
} from "./url-params";
import { classifyQueryError } from "./use-query";

export type ArrivalMedia = {
  source_image_index: number;
  source_image_url: string;
  content_sha256: string;
};

export type ArrivalPost = {
  arrival_key: string;
  buyer_handle: string;
  twitter_handle: string;
  tweet_id: string;
  tweet_url: string;
  tweet_created_at: string | null;
  acquired_at: string;
  /**
   * The re-post fields. A shop re-surfaces an arrival by retweeting it, which
   * means the stock is still there; the backend sends when it last did
   * (`last_boosted_at`), how often (`boost_count`), and the handle the post was
   * retweeted from (`via_retweet_of`). Older backends send none of them, and
   * the parser reads that as never re-posted.
   */
  last_boosted_at: string | null;
  boost_count: number;
  via_retweet_of: string | null;
  /**
   * The post's original caption, as the shop wrote it (migration 000605).
   * Older backends send no column and posts captured before the caption was
   * kept send null; both read as "nothing to show". Entity escapes are decoded.
   */
  tweet_text: string | null;
  /**
   * The region key of the shop's region ("fukuoka"), or null while the shop
   * is not mapped to one yet. Older backends send no column, which reads as null.
   */
  region: string | null;
  unverified: true;
  media: ArrivalMedia[];
};

export type ArrivalCursor = {
  before: string;
  before_key: string;
};

export type ArrivalPostsPage = {
  posts: ArrivalPost[];
  nextCursor: ArrivalCursor | null;
};

/**
 * Loads one page of posts. `since` is the window's start (RFC 3339, inclusive)
 * for the RPC's `p_since`, or null for All; `regions` are the region keys for
 * the RPC's `p_regions`, empty for All regions, which sends no region at all.
 */
export type ArrivalPostsLoader = (
  buyerHandle: string,
  cursor: ArrivalCursor | null,
  since: string | null,
  regions: readonly string[],
) => Promise<ArrivalPostsPage>;

/**
 * Loads the per-account summary, counting each account's recent posts from
 * `since` (RFC 3339, the tab's window cutoff) or, when null, from the backend
 * default of 24 hours. Resolves null when the backend RPC is not applied yet,
 * in which case the view derives the list from the posts it has.
 */
export type ArrivalSourcesLoader = (since: string | null) => Promise<ArrivalSource[] | null>;

export class ArrivalPostsRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ArrivalPostsRequestError";
    this.status = status;
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid arrival field: ${field}`);
  }
  return value;
}

function parseURL(value: unknown, field: string): string {
  const parsed = requiredString(value, field);
  let url: URL;
  try {
    url = new URL(parsed, "http://fixture.local");
  } catch {
    throw new Error(`Invalid arrival URL: ${field}`);
  }
  if (!["http:", "https:", "data:"].includes(url.protocol)) {
    throw new Error(`Invalid arrival URL scheme: ${field}`);
  }
  return parsed;
}

// The re-post fields are optional on a row: absent or null means never re-posted.
function optionalTimestamp(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid arrival timestamp: ${field}`);
  }
  return value;
}

function optionalHandle(value: unknown, field: string): string | null {
  return value == null ? null : requiredString(value, field);
}

// The caption is optional on a row: absent, null, or blank means nothing to show.
function optionalText(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(`Invalid arrival field: ${field}`);
  const text = decodeTweetText(value).trim();
  return text === "" ? null : text;
}

// The region is optional on a row: absent or null means the shop has no region yet.
function optionalRegion(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || !REGION_RE.test(value)) {
    throw new Error(`Invalid arrival field: ${field}`);
  }
  return value;
}

function countOrZero(value: unknown, field: string): number {
  if (value == null) return 0;
  const count = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(count) || Number(count) < 0) {
    throw new Error(`Invalid arrival count: ${field}`);
  }
  return Number(count);
}

export function parseArrivalPosts(value: unknown): ArrivalPost[] {
  if (!Array.isArray(value)) throw new Error("Invalid arrival response");
  return value.map((raw, rowIndex) => {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Invalid arrival row: ${rowIndex}`);
    }
    const row = raw as Record<string, unknown>;
    for (const forbidden of ["item_identity", "price_jpy", "price_side", "grade", "condition"]) {
      if (forbidden in row) throw new Error(`Forbidden arrival field: ${forbidden}`);
    }
    if (row.unverified !== true || !Array.isArray(row.media) || row.media.length < 1) {
      throw new Error(`Invalid arrival evidence: ${rowIndex}`);
    }
    const tweetCreatedAt = row.tweet_created_at;
    if (tweetCreatedAt !== null && typeof tweetCreatedAt !== "string") {
      throw new Error(`Invalid arrival timestamp: ${rowIndex}`);
    }
    return {
      arrival_key: requiredString(row.arrival_key, "arrival_key"),
      buyer_handle: requiredString(row.buyer_handle, "buyer_handle"),
      twitter_handle: requiredString(row.twitter_handle, "twitter_handle"),
      tweet_id: requiredString(row.tweet_id, "tweet_id"),
      tweet_url: parseURL(row.tweet_url, "tweet_url"),
      tweet_created_at: tweetCreatedAt,
      acquired_at: requiredString(row.acquired_at, "acquired_at"),
      last_boosted_at: optionalTimestamp(row.last_boosted_at, `last_boosted_at: ${rowIndex}`),
      boost_count: countOrZero(row.boost_count, `boost_count: ${rowIndex}`),
      via_retweet_of: optionalHandle(row.via_retweet_of, `via_retweet_of: ${rowIndex}`),
      tweet_text: optionalText(row.tweet_text, `tweet_text: ${rowIndex}`),
      region: optionalRegion(row.region, `region: ${rowIndex}`),
      unverified: true,
      media: row.media.map((rawMedia, mediaIndex) => {
        if (rawMedia == null || typeof rawMedia !== "object" || Array.isArray(rawMedia)) {
          throw new Error(`Invalid arrival media: ${rowIndex}/${mediaIndex}`);
        }
        const media = rawMedia as Record<string, unknown>;
        const sourceImageIndex = media.source_image_index;
        if (!Number.isInteger(sourceImageIndex) || Number(sourceImageIndex) < 0) {
          throw new Error(`Invalid arrival media index: ${rowIndex}/${mediaIndex}`);
        }
        const digest = requiredString(media.content_sha256, "content_sha256");
        if (!/^[0-9a-f]{64}$/.test(digest)) {
          throw new Error(`Invalid arrival media digest: ${rowIndex}/${mediaIndex}`);
        }
        return {
          source_image_index: Number(sourceImageIndex),
          source_image_url: parseURL(media.source_image_url, "source_image_url"),
          content_sha256: digest,
        };
      }),
    };
  });
}

function parseArrivalCursor(value: unknown): ArrivalCursor | null {
  if (value === null) return null;
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid arrival cursor");
  }
  const raw = value as Record<string, unknown>;
  const before = requiredString(raw.before, "next_cursor.before");
  const beforeKey = requiredString(raw.before_key, "next_cursor.before_key");
  if (Number.isNaN(Date.parse(before)) || beforeKey.length > 512) {
    throw new Error("Invalid arrival cursor");
  }
  return { before, before_key: beforeKey };
}

function requestError(status: number, body: unknown): ArrivalPostsRequestError {
  const message = body != null && typeof body === "object"
    && "error" in body && typeof body.error === "string"
    ? body.error
    : `HTTP ${status}`;
  return new ArrivalPostsRequestError(status, message);
}

export const loadArrivalPosts: ArrivalPostsLoader = async (buyerHandle, cursor, since, regions) => {
  const query = new URLSearchParams({ limit: "100" });
  if (buyerHandle) query.set("buyer_handle", buyerHandle);
  if (cursor) {
    query.set("before", cursor.before);
    query.set("before_key", cursor.before_key);
  }
  if (since) query.set("since", since);
  if (regions.length > 0) query.set("regions", regions.join(","));
  const response = await fetch(`/api/twitter-arrivals?${query}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw requestError(response.status, body);
  if (body == null || typeof body !== "object" || !("posts" in body)
    || !("next_cursor" in body)) {
    throw new Error("Invalid arrival response");
  }
  return {
    posts: parseArrivalPosts(body.posts),
    nextCursor: parseArrivalCursor(body.next_cursor),
  };
};

export const loadArrivalSources: ArrivalSourcesLoader = async (since) => {
  const query = new URLSearchParams();
  if (since) query.set("since", since);
  const search = query.toString();
  const response = await fetch(`/api/twitter-arrivals/sources${search ? `?${search}` : ""}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  const body = await response.json().catch(() => null) as unknown;
  // 501 is the route's "the backend RPC is not applied yet" answer, which is a
  // reason to fall back, not a failure to report.
  if (response.status === 501) return null;
  if (!response.ok) throw requestError(response.status, body);
  if (body == null || typeof body !== "object" || !("sources" in body)) {
    throw new Error("Invalid arrival sources response");
  }
  return parseArrivalSources(body.sources);
};

function previewURL(sourceURL: string): string {
  if (sourceURL.startsWith("data:") || sourceURL.startsWith("/")) return sourceURL;
  return `/api/proxy-image?url=${encodeURIComponent(sourceURL)}`;
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

function seenPost(post: ArrivalPost): ArrivalAccountPost {
  return {
    arrival_key: post.arrival_key,
    buyer_handle: post.buyer_handle,
    twitter_handle: post.twitter_handle,
    tweet_created_at: post.tweet_created_at,
    acquired_at: post.acquired_at,
    last_boosted_at: post.last_boosted_at,
  };
}

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

function ArrivalLoadFailure({
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
        <p className="font-medium">{t("arrivals.sessionExpiredTitle")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("arrivals.sessionExpiredBody")}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <a
            href="/login"
            target="_blank"
            rel="noreferrer"
            className={cn("inline-flex min-h-11 items-center justify-center rounded-lg border bg-background px-4 text-sm font-medium hover:bg-accent sm:min-h-8", FOCUS_RING)}
          >
            {t("arrivals.signInAgain")}
          </a>
          <Button className="min-h-11 sm:min-h-8" variant="outline" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            {t("arrivals.continueAfterSignIn")}
          </Button>
        </div>
      </div>
    );
  }

  if (kind === "forbidden") {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4" role="alert">
        <p className="font-medium">{t("arrivals.adminRequiredTitle")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("arrivals.adminRequiredBody")}</p>
        <a
          href="/login"
          target="_blank"
          rel="noreferrer"
          className={cn("mt-3 inline-flex min-h-11 items-center justify-center rounded-lg border bg-background px-4 text-sm font-medium hover:bg-accent sm:min-h-8", FOCUS_RING)}
        >
          {t("arrivals.signInAsAdmin")}
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
        {t("arrivals.retry")}
      </Button>
    </div>
  );
}

// The X handle is the identity every enrolled shop has; the curated label from
// lib/source-labels.ts exists for a minority and is only ever the second line.
function AccountIdentity({
  twitterHandle,
  buyerHandle,
  className,
}: {
  twitterHandle: string;
  buyerHandle: string;
  className?: string;
}) {
  const label = accountLabel(buyerHandle);
  return (
    <span className={cn("flex min-w-0 flex-wrap items-baseline gap-x-2", className)}>
      <span className="min-w-0 break-all font-medium">@{twitterHandle}</span>
      {label && <span className="min-w-0 break-words text-sm text-muted-foreground">{label}</span>}
    </span>
  );
}

function AccountButton({
  pressed,
  onClick,
  primary,
  secondary,
  recent,
  recentWindow,
  total,
}: {
  pressed: boolean;
  onClick: () => void;
  primary: string;
  secondary?: string | null;
  recent: number;
  /** The window `recent` counts, as its chip reads ("48 h"). */
  recentWindow: string;
  total: number;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent sm:min-h-9",
        FOCUS_RING,
        pressed && "bg-accent font-medium",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{primary}</span>
        {secondary && <span className="block truncate text-xs font-normal text-muted-foreground">{secondary}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end text-xs tabular-nums">
        <span className={recent > 0 ? "text-foreground" : "text-muted-foreground"}>
          {t("arrivals.recentCount", { count: recent, window: recentWindow })}
        </span>
        <span className="font-normal text-muted-foreground">
          {total === 1 ? t("arrivals.postCountOne") : t("arrivals.postCount", { count: total })}
        </span>
      </span>
    </button>
  );
}

type SourcesState =
  | { status: "loading" }
  | { status: "ready"; sources: ArrivalSource[] }
  | { status: "fallback" }
  | { status: "error"; error: Error };

function ArrivalAccountPanel({
  accounts,
  regionLabel,
  selected,
  onSelect,
  state,
  postsFailed,
  onRetry,
  open,
  onToggle,
  query,
  onQueryChange,
  recentWindow,
}: {
  accounts: ArrivalSource[];
  /** The selected regions in words, the All row's second line while the list is narrowed to them. */
  regionLabel: string | null;
  selected: string;
  onSelect: (buyerHandle: string) => void;
  state: SourcesState;
  postsFailed: boolean;
  onRetry: () => void;
  open: boolean;
  onToggle: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  recentWindow: string;
}) {
  const { t } = useTranslation();
  const totals = accounts.reduce(
    (sum, account) => ({
      recent: sum.recent + account.recent_count,
      total: sum.total + account.post_count,
    }),
    { recent: 0, total: 0 },
  );
  const visible = accounts.filter((account) => matchesAccountQuery(account, query));

  return (
    <aside className="min-w-0 md:sticky md:top-4 md:self-start" aria-labelledby="arrival-accounts-title">
      <div className="rounded-xl border bg-card">
        <div className="flex min-h-11 items-center justify-between gap-2 px-3 py-1.5">
          <h2 id="arrival-accounts-title" className="flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4 text-muted-foreground" aria-hidden="true" />
            {t("arrivals.accountsTitle")}
            <span className="font-normal text-muted-foreground tabular-nums">({accounts.length})</span>
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="md:hidden"
            aria-expanded={open}
            aria-controls="arrival-account-list"
            onClick={onToggle}
          >
            {open ? t("arrivals.hideAccounts") : t("arrivals.showAccounts")}
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
          </Button>
        </div>
        <div id="arrival-account-list" className={cn("space-y-2 border-t p-2", open ? "block" : "hidden md:block")}>
          <Input
            type="search"
            aria-label={t("arrivals.accountSearch")}
            placeholder={t("arrivals.accountSearchPlaceholder")}
            className="h-11 sm:h-8"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            autoComplete="off"
          />
          <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto md:max-h-[calc(100dvh-14rem)]" data-testid="arrival-accounts">
            <li>
              <AccountButton
                pressed={selected === ""}
                onClick={() => onSelect("")}
                primary={t("arrivals.allAccounts")}
                secondary={regionLabel}
                recent={totals.recent}
                recentWindow={recentWindow}
                total={totals.total}
              />
            </li>
            {visible.map((account) => (
              <li key={account.buyer_handle}>
                <AccountButton
                  pressed={selected === account.buyer_handle}
                  onClick={() => onSelect(account.buyer_handle)}
                  primary={`@${account.twitter_handle}`}
                  secondary={accountLabel(account.buyer_handle)}
                  recent={account.recent_count}
                  recentWindow={recentWindow}
                  total={account.post_count}
                />
              </li>
            ))}
          </ul>
          {query.trim() !== "" && visible.length === 0 && (
            <p className="px-2 text-xs text-muted-foreground">{t("arrivals.accountsNoMatch")}</p>
          )}
          {state.status === "loading" && (
            <p className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground" role="status">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              {t("arrivals.accountsLoading")}
            </p>
          )}
          {state.status === "fallback" && (
            <p className="px-2 text-xs text-muted-foreground" data-testid="arrival-accounts-fallback-note">
              {t("arrivals.accountsFromLoadedPosts")}
            </p>
          )}
          {state.status === "error" && !postsFailed && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs" role="alert">
              <p className="font-medium">{t("arrivals.accountsErrorTitle")}</p>
              <p className="mt-0.5 break-words text-muted-foreground">{state.error.message}</p>
              <Button size="sm" variant="outline" className="mt-2 min-h-11 sm:min-h-7" onClick={onRetry}>
                <RefreshCw aria-hidden="true" />
                {t("arrivals.retry")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

// The post's caption as the shop wrote it: plain text with its line breaks,
// clamped to a few lines until the viewer asks for all of it. Whether the clamp
// actually hides anything is measured, not guessed, because the same 140
// Japanese characters fill three lines on a wide card and nine on a narrow one.
function ArrivalText({ text }: { text: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const body = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const element = body.current;
    if (!element || expanded) return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, text]);

  return (
    <div className="min-w-0 space-y-1" data-testid="arrival-text">
      <p
        ref={body}
        lang="ja"
        className={cn("min-w-0 break-words whitespace-pre-line text-sm", !expanded && "line-clamp-6")}
        data-testid="arrival-text-body"
      >
        {tweetTextSegments(text).map((segment, index) => (
          segment.kind === "link" ? (
            <a
              key={index}
              href={segment.value}
              target="_blank"
              rel="noreferrer noopener"
              className={cn("break-all text-primary underline underline-offset-2", FOCUS_RING)}
            >
              {segment.value}
            </a>
          ) : (
            <Fragment key={index}>{segment.value}</Fragment>
          )
        ))}
      </p>
      {(overflows || expanded) && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto min-h-11 px-0 sm:min-h-0"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? t("arrivals.textShowLess") : t("arrivals.textShowMore")}
        </Button>
      )}
    </div>
  );
}

function ArrivalPostCard({
  post,
  dateTime,
  now,
}: {
  post: ArrivalPost;
  dateTime: (value: string | null) => string;
  /** The moment the feed loaded; "re-posted 3 hours ago" is measured from it. */
  now: number;
}) {
  const { t, language } = useTranslation();
  const label = accountLabel(post.buyer_handle);
  const shop = label ?? `@${post.twitter_handle}`;
  // A re-post means the stock is still there, so the card says when it happened.
  const reposted = post.last_boosted_at === null
    ? null
    : relativeTime(post.last_boosted_at, now, language === "ja" ? "ja-JP" : "en-US") ?? dateTime(post.last_boosted_at);
  return (
    <Card className="min-w-0" data-testid="arrival-post-card" data-arrival-key={post.arrival_key}>
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CardTitle className="min-w-0 break-all">@{post.twitter_handle}</CardTitle>
          <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200">
            {t("arrivals.unverified")}
          </Badge>
          {reposted !== null && (
            <Badge
              variant="outline"
              className="border-sky-500/50 bg-sky-500/10 text-sky-800 dark:text-sky-200"
              title={`${t("arrivals.repostedTime")}: ${dateTime(post.last_boosted_at)}`}
              data-testid="arrival-reposted"
            >
              <Repeat2 aria-hidden="true" />
              {post.boost_count > 1
                ? t("arrivals.repostedTimes", { count: post.boost_count, when: reposted })
                : t("arrivals.reposted", { when: reposted })}
            </Badge>
          )}
        </div>
        <CardDescription className="space-y-1 break-words">
          {label && <div>{label}</div>}
          {post.via_retweet_of !== null && (
            <div data-testid="arrival-via">{t("arrivals.viaRetweet", { handle: post.via_retweet_of })}</div>
          )}
          <div>
            {t("arrivals.sourcePostTime")}: {dateTime(post.tweet_created_at)}
          </div>
          <div>
            {t("arrivals.collectedTime")}: {dateTime(post.acquired_at)}
          </div>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {post.tweet_text !== null && <ArrivalText text={post.tweet_text} />}
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
          {post.media.map((media) => (
            <a
              key={`${post.arrival_key}:${media.source_image_index}`}
              href={media.source_image_url}
              target="_blank"
              rel="noreferrer"
              className={cn("group relative flex aspect-square min-h-24 min-w-0 items-center justify-center overflow-hidden rounded-lg border bg-muted", FOCUS_RING)}
              aria-label={t("arrivals.openMedia", { number: media.source_image_index + 1 })}
            >
              <img
                src={previewURL(media.source_image_url)}
                alt={t("arrivals.mediaAlt", { number: media.source_image_index + 1, shop })}
                className="h-full w-full object-contain transition-transform group-hover:scale-[1.02]"
                loading="lazy"
              />
              <span className="sr-only">{media.content_sha256}</span>
            </a>
          ))}
        </div>
        <a
          href={post.tweet_url}
          target="_blank"
          rel="noreferrer"
          className={cn("inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent sm:w-auto", FOCUS_RING)}
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          {t("arrivals.openSource")}
        </a>
      </CardContent>
    </Card>
  );
}

// Arrival posts are time-sensitive, so the feed shows a window (48 hours by
// default) rather than every post ever captured. All still shows everything,
// because nothing is deleted.
function ArrivalWindowChips({
  value,
  onChange,
}: {
  value: ArrivalWindow;
  onChange: (window: ArrivalWindow) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("arrivals.windowLabel")}
      className="flex flex-wrap items-center gap-1"
      data-testid="arrival-window"
    >
      <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
      {ARRIVAL_WINDOWS.map((option) => (
        <Button
          key={option}
          type="button"
          variant={option === value ? "secondary" : "outline"}
          className="h-11 px-3 sm:h-8"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
        >
          {t(`arrivals.window.${option}`)}
        </Button>
      ))}
    </div>
  );
}

function readSelectedShop(): string {
  return parseShopParam(readUrlParam(ARRIVALS_SHOP_PARAM)) ?? "";
}

function readSelectedRegions(): string[] {
  return parseRegionsParam(readUrlParam(ARRIVALS_REGION_PARAM));
}

/** The window a link names, else the viewer's remembered choice (default 48 h). */
function readSelectedWindow(): ArrivalWindow {
  return parseWindowParam(readUrlParam(ARRIVALS_WINDOW_PARAM)) ?? readArrivalWindow();
}

export default function ArrivalPostsView({
  loader = loadArrivalPosts,
  sourcesLoader = loadArrivalSources,
  regionLoader,
  regionSender,
}: {
  loader?: ArrivalPostsLoader;
  sourcesLoader?: ArrivalSourcesLoader;
  /** The focus regions' status and changes (backend #2342); defaults call the API route. */
  regionLoader?: RegionStatusLoader;
  regionSender?: RegionActionSender;
}) {
  const { t, language } = useTranslation();
  // The selected shop is a leaf URL param (?shop=...) so one account's arrivals
  // can be linked and bookmarked; UrlStateSync drops it when the view changes.
  const [selected, setSelected] = useState(readSelectedShop);
  // The selected regions are a leaf param too (?region=akihabara,fukuoka),
  // sorted and each once; All regions, the empty list, stays out of the URL.
  const [regionsKey, setRegionsKey] = useState(() => readSelectedRegions().join(","));
  const regions = useMemo(() => (regionsKey === "" ? [] : regionsKey.split(",")), [regionsKey]);
  const setRegions = useCallback((next: Iterable<string>) => {
    setRegionsKey(canonicalRegions(next).join(","));
  }, []);
  // The time window is a leaf param too (?since=24h|48h|7d|all); the default
  // stays out of the URL, and the viewer's choice is remembered in localStorage.
  const [since, setSince] = useState(readSelectedWindow);
  // When the feed was (re)loaded. The window's cutoff is measured from this
  // moment so appended pages and the account counts agree on it; Refresh moves it.
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const [posts, setPosts] = useState<ArrivalPost[]>([]);
  const [nextCursor, setNextCursor] = useState<ArrivalCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);
  // Every post seen this session, across accounts and pages, so the account
  // list can be derived while the backend summary is unavailable.
  const [seen, setSeen] = useState<Map<string, ArrivalAccountPost>>(() => new Map());
  const [sourcesState, setSourcesState] = useState<SourcesState>({ status: "loading" });
  // The latest account summary that carried regions. It stays while the next
  // one loads, so the filter and the narrowed list hold still through a window
  // change; a summary without regions (a backend from before the filter, or
  // the derived fallback) sets it to null, which hides the filter.
  const [regionSources, setRegionSources] = useState<ArrivalSource[] | null>(null);
  // The focus status, shared by the region panel and the region filter.
  const regionStatus = useArrivalRegionStatus(regionLoader, regionSender);
  const focusStatus = regionStatus.state.status === "ready" ? regionStatus.state.data : null;
  // Read-once requests the filter has in flight, and the refusal of each
  // region's last one; a region whose read the view has followed (asked for,
  // or seen pending while selected) says when it was read once it is done.
  const [requestingReads, setRequestingReads] = useState<ReadonlySet<string>>(() => new Set());
  const [readFailures, setReadFailures] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [followedReads, setFollowedReads] = useState<ReadonlySet<string>>(() => new Set());
  const requestingRef = useRef(new Set<string>());
  const [groupByAccount, setGroupByAccount] = useState(readGroupByAccount);
  const [collapsed, setCollapsed] = useState(readCollapsedAccounts);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [accountQuery, setAccountQuery] = useState("");
  const requestGeneration = useRef(0);
  const sourcesGeneration = useRef(0);
  // The feed column, for keeping the reader's place when a refresh merges
  // posts in above it, and the place to keep.
  const feedRef = useRef<HTMLDivElement>(null);
  const scrollAnchor = useRef<ScrollAnchor | null>(null);
  const postsRef = useRef<ArrivalPost[]>([]);
  postsRef.current = posts;

  useEffect(() => {
    writeUrlParam(ARRIVALS_SHOP_PARAM, selected || null);
  }, [selected]);

  useEffect(() => {
    writeUrlParam(ARRIVALS_WINDOW_PARAM, since === DEFAULT_ARRIVAL_WINDOW ? null : since);
  }, [since]);

  useEffect(() => {
    writeUrlParam(ARRIVALS_REGION_PARAM, formatRegionsParam(regions));
  }, [regions]);

  useEffect(() => {
    const onPop = () => {
      setSelected(readSelectedShop());
      setRegions(readSelectedRegions());
      setSince(readSelectedWindow());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [setRegions]);

  // `cutoff` is the oldest observed time the window shows (null for All); it
  // goes to the RPC as p_since. A finite window is loaded whole: the first page
  // shows as soon as it arrives and the rest stream in behind a visible loading
  // state, page after page, until the window is exhausted (the RPC returns a
  // short page, or a page ends past the cutoff) or the run reaches
  // MAX_WINDOW_PAGES, where Load more takes over. All pages by hand only.
  const load = useCallback(async (
    buyerHandle: string,
    regionKeys: readonly string[],
    cursor: ArrivalCursor | null,
    append: boolean,
    cutoff: number | null,
  ) => {
    const generation = ++requestGeneration.current;
    const current = () => requestGeneration.current === generation;
    if (append) {
      setLoadingMore(true);
      setLoadMoreError(null);
    } else {
      setLoading(true);
      setError(null);
      setLoadMoreError(null);
      setPosts([]);
      setNextCursor(null);
    }
    const since = cutoffISO(cutoff);
    let first = !append;
    let next = cursor;
    let pages = 0;
    try {
      do {
        const page = await loader(buyerHandle, next, since, regionKeys);
        if (!current()) return;
        pages += 1;
        const replace = first;
        setPosts((known) => {
          if (replace) return page.posts;
          const keys = new Set(known.map((post) => post.arrival_key));
          return [
            ...known,
            ...page.posts.filter((post) => {
              if (keys.has(post.arrival_key)) return false;
              keys.add(post.arrival_key);
              return true;
            }),
          ];
        });
        setSeen((known) => {
          const merged = new Map(known);
          for (const post of page.posts) merged.set(post.arrival_key, seenPost(post));
          return merged;
        });
        next = pageExhaustsWindow(page.posts, cutoff) ? null : page.nextCursor;
        setNextCursor(next);
        if (first) {
          first = false;
          setLoading(false);
        }
        if (windowPagingContinues(cutoff, next, pages)) setLoadingMore(true);
      } while (windowPagingContinues(cutoff, next, pages));
    } catch (reason) {
      if (!current()) return;
      const failure = asError(reason);
      if (first) setError(failure);
      else setLoadMoreError(failure);
    } finally {
      if (current()) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [loader]);

  const applySources = useCallback((sources: ArrivalSource[] | null) => {
    setSourcesState(sources === null ? { status: "fallback" } : { status: "ready", sources });
    // The regions come with the summary. One without them hides the filter
    // and drops a linked region, which that backend could not apply: the feed
    // sends p_regions only to a backend whose summary has regions.
    const carries = sources !== null && sourcesCarryRegions(sources);
    setRegionSources(carries ? sources : null);
    if (!carries) setRegions([]);
  }, [setRegions]);

  const loadSources = useCallback(async (sinceISO: string | null) => {
    const generation = ++sourcesGeneration.current;
    setSourcesState({ status: "loading" });
    try {
      const sources = await sourcesLoader(sinceISO);
      if (sourcesGeneration.current !== generation) return;
      applySources(sources);
    } catch (reason) {
      if (sourcesGeneration.current !== generation) return;
      setSourcesState({ status: "error", error: asError(reason) });
    }
  }, [sourcesLoader, applySources]);

  const cutoff = useMemo(() => windowCutoff(since, loadedAt), [since, loadedAt]);

  // Both load effects key on `loadedAt`, not on `cutoff`: for All the cutoff is
  // null before and after a Refresh, and Refresh must still reload.
  useEffect(() => {
    void load(selected, regions, null, false, windowCutoff(since, loadedAt));
  }, [selected, regions, since, loadedAt, load]);

  // A shop outside the selected regions has no posts in their feed, so a link
  // naming both, or a shop the summary has since moved, drops the shop.
  useEffect(() => {
    if (regions.length > 0 && selected && regionSources !== null
      && !accountInRegions(regionSources, selected, new Set(regions))) {
      setSelected("");
    }
  }, [regions, selected, regionSources]);

  // A linked region neither the focus status nor the summary knows (a typo,
  // or a retired key) is dropped once both have loaded.
  useEffect(() => {
    if (regionSources === null) return;
    const unknown = unknownRegions(regions, regionSources, focusStatus);
    if (unknown.length > 0) setRegions(regions.filter((region) => !unknown.includes(region)));
  }, [regions, regionSources, focusStatus, setRegions]);

  // A selected region seen with a read pending is followed, wherever the read
  // was asked for (here, the region panel, another device), so the header can
  // say when it was read.
  useEffect(() => {
    if (focusStatus === null) return;
    const pending = focusStatus.regions
      .filter((entry) => entry.pending_request !== null && regions.includes(entry.region))
      .map((entry) => entry.region)
      .filter((region) => !followedReads.has(region));
    if (pending.length > 0) setFollowedReads((known) => new Set([...known, ...pending]));
  }, [focusStatus, regions, followedReads]);

  // The same cutoff goes to the summary RPC as p_since, so each account's
  // recent count is the window's; All leaves the backend default (24 hours).
  useEffect(() => {
    void loadSources(cutoffISO(windowCutoff(since, loadedAt)));
  }, [since, loadedAt, loadSources]);

  // Each account's region, by the latest summary that carried regions.
  const regionOf = useMemo(
    () => regionSources === null
      ? null
      : new Map(regionSources.map((source) => [source.buyer_handle, source.region ?? null])),
    [regionSources],
  );

  const accounts = useMemo(() => {
    let list = sourcesState.status === "ready"
      ? sortArrivalSources(sourcesState.sources)
      : deriveArrivalSources(seen.values(), Date.now(), cutoff);
    // Regions narrow the list to their accounts, by the summary's mapping, so
    // the list stays narrowed while a new summary loads.
    if (regions.length > 0 && regionOf !== null) {
      const chosen = new Set(regions);
      list = list.filter((account) => chosen.has(regionOf.get(account.buyer_handle) ?? ""));
    }
    // A linked shop the summary does not list (a typo, or a brand-new account)
    // still shows as the selection, so the pressed state has somewhere to live.
    if (selected && !list.some((account) => account.buyer_handle === selected)) {
      const known = [...seen.values()].find((post) => post.buyer_handle === selected);
      list.push({
        buyer_handle: selected,
        twitter_handle: known?.twitter_handle ?? selected,
        post_count: 0,
        recent_count: 0,
        latest_post_at: null,
      });
    }
    return list;
  }, [sourcesState, seen, selected, cutoff, regions, regionOf]);

  // The filter's rows: every region the focus status lists, else the regions
  // the summary uses; null (no summary with regions) hides the filter.
  const regionOptions = useMemo(
    () => (regionSources === null ? null : regionFilterOptions(regionSources, focusStatus, regions)),
    [regionSources, focusStatus, regions],
  );

  const selectedAccount = selected
    ? accounts.find((account) => account.buyer_handle === selected) ?? null
    : null;

  // The RPC already applies the window as p_since; the same cutoff applies here
  // too, so a backend without it (or a row on the boundary) cannot show a post
  // the window excludes. The rows arrive newest first, so dropping those past
  // the cutoff is exact.
  const visible = useMemo(() => postsWithinWindow(posts, cutoff), [posts, cutoff]);
  const hidden = posts.length - visible.length;

  // Once there is no page left, the loaded posts are every post in the window
  // (or, for All, every post there is), and the group headers count them as
  // such; until then they say how many are loaded so far.
  const windowComplete = nextCursor === null;

  // Grouping the visible rows also leaves out the accounts with nothing in the window.
  const groups = useMemo(
    () => (groupByAccount && !selected ? groupPostsByAccount(visible) : null),
    [groupByAccount, selected, visible],
  );

  const select = (buyerHandle: string) => {
    setSelected(buyerHandle);
    setAccountsOpen(false);
  };

  // Asks for a read once of a region the run does not read hourly, has
  // nothing pending for and has a list to read, through the same action as the
  // region panel's Read once. Never twice at once: the request in flight is
  // remembered here and an accepted one shows as pending in the status the
  // RPC answers with, which both the panel and the filter then show. A refusal
  // shows on the region and the status is loaded again.
  const requestRead = async (region: string) => {
    const entry = focusStatus?.regions.find((candidate) => candidate.region === region);
    if (entry === undefined || !needsReadOnce(entry) || requestingRef.current.has(region)) return;
    requestingRef.current.add(region);
    setRequestingReads(new Set(requestingRef.current));
    setFollowedReads((known) => new Set([...known, region]));
    setReadFailures((known) => {
      const next = new Map(known);
      next.delete(region);
      return next;
    });
    try {
      await regionStatus.send({ action: "request_read", region });
    } catch (reason) {
      setReadFailures((known) => new Map(known).set(region, asError(reason).message));
      void regionStatus.reload({ quiet: true });
    } finally {
      requestingRef.current.delete(region);
      setRequestingReads(new Set(requestingRef.current));
    }
  };

  // The selected shop stays only while it is in one of the selected regions;
  // All regions keeps it. Selecting a region also asks for a read when it
  // needs one; deselecting cancels nothing.
  const toggleRegion = (region: string) => {
    const adding = !regions.includes(region);
    const next = adding ? [...regions, region] : regions.filter((key) => key !== region);
    setRegions(next);
    if (next.length > 0 && selected
      && !(regionSources !== null && accountInRegions(regionSources, selected, new Set(next)))) {
      setSelected("");
    }
    if (adding) void requestRead(region);
  };

  const clearRegions = () => setRegions([]);

  // While a selected region is being read once, the feed refreshes quietly:
  // the status first, so the last refresh after the read ends still finds
  // every post it brought, then the summary (new accounts and their counts)
  // and the newest posts, merged in without touching the pages already
  // loaded or the reader's place. A full load or Load more that starts
  // meanwhile wins, and a failed refresh changes nothing.
  const pollBusy = useRef(false);
  const pollTick = useRef<() => Promise<void>>(async () => {});
  pollTick.current = async () => {
    if (pollBusy.current) return;
    pollBusy.current = true;
    try {
      await regionStatus.reload({ quiet: true });
      await Promise.all([refreshSources(), refreshFeed()]);
    } finally {
      pollBusy.current = false;
    }
  };

  const refreshSources = async () => {
    if (sourcesState.status === "loading") return;
    const generation = sourcesGeneration.current;
    try {
      const sources = await sourcesLoader(cutoffISO(cutoff));
      if (sourcesGeneration.current === generation) applySources(sources);
    } catch {
      // The last summary stays; the next refresh tries again.
    }
  };

  const refreshFeed = async () => {
    if (loading || loadingMore || error !== null) return;
    const generation = requestGeneration.current;
    const known = new Set(postsRef.current.map((post) => post.arrival_key));
    const fresh: ArrivalPost[] = [];
    let cursor: ArrivalCursor | null = null;
    let pages = 0;
    try {
      // Newest first, until a page reaches a post already loaded, so a burst
      // of more posts than a page holds leaves no gap.
      do {
        const page = await loader(selected, cursor, cutoffISO(cutoff), regions);
        if (requestGeneration.current !== generation) return;
        pages += 1;
        fresh.push(...page.posts);
        const reached = page.posts.some((post) => known.has(post.arrival_key));
        cursor = reached || pageExhaustsWindow(page.posts, cutoff) ? null : page.nextCursor;
      } while (cursor !== null && pages < MAX_POLL_PAGES);
    } catch {
      return;
    }
    if (mergeFreshPosts(postsRef.current, fresh) === postsRef.current) return;
    scrollAnchor.current = captureScrollAnchor(feedRef.current);
    setPosts((current) => mergeFreshPosts(current, fresh) as ArrivalPost[]);
    setSeen((current) => {
      const merged = new Map(current);
      for (const post of fresh) merged.set(post.arrival_key, seenPost(post));
      return merged;
    });
  };

  // Back to the reader's place once merged posts are on screen.
  useLayoutEffect(() => {
    if (scrollAnchor.current === null) return;
    restoreScrollAnchor(feedRef.current, scrollAnchor.current);
    scrollAnchor.current = null;
  }, [posts]);

  // Polls while a selected region has a read pending: every POLL_INTERVAL_MS,
  // skipping ticks while the tab is hidden (and catching up when it shows
  // again), for at most POLL_LIMIT_MS per run. A new request starts a new run;
  // the read ending, or its region being deselected, ends it.
  const pollKey = pendingReadKey(focusStatus, regions);
  useEffect(() => {
    if (pollKey === "") return;
    const started = Date.now();
    let missed = false;
    const tick = () => {
      if (Date.now() - started >= POLL_LIMIT_MS) {
        stop();
        return;
      }
      if (document.visibilityState === "hidden") {
        missed = true;
        return;
      }
      missed = false;
      void pollTick.current();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && missed) tick();
    };
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    function stop() {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    }
    return stop;
  }, [pollKey]);

  // Moves the window's cutoff to now; both load effects above run from it.
  const refresh = () => setLoadedAt((previous) => Math.max(Date.now(), previous + 1));

  const setWindow = (window: ArrivalWindow) => {
    setSince(window);
    writeArrivalWindow(window);
  };

  const setGrouping = (enabled: boolean) => {
    setGroupByAccount(enabled);
    writeGroupByAccount(enabled);
  };

  const toggleCollapsed = (buyerHandle: string) => {
    const next = new Set(collapsed);
    if (next.has(buyerHandle)) next.delete(buyerHandle);
    else next.add(buyerHandle);
    setCollapsed(next);
    writeCollapsedAccounts(next);
  };

  const dateTime = useCallback((value: string | null) => {
    if (value === null) return t("arrivals.unknownTime");
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return t("arrivals.unknownTime");
    return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Tokyo",
    }).format(parsed);
  }, [language, t]);

  // The recent count's label: the window, or the backend's 24-hour default for All.
  const recentWindow = t(`arrivals.window.${since === "all" ? "24h" : since}`);

  // The selection in words: one or two names, or how many.
  const regionLabel = regions.length > 0 && regionOptions !== null
    ? regionSelectionSummary(t, regions, regionOptions)
    : null;

  // What each selected region's read is doing, for the feed header.
  const now = Date.now();
  const regionReads = (regionOptions ?? [])
    .filter((option) => regions.includes(option.region))
    .flatMap(({ region, status }): { region: string; progress: RegionReadProgress }[] => {
      if (requestingReads.has(region)) return [{ region, progress: { kind: "requesting" } }];
      const failure = readFailures.get(region);
      if (failure !== undefined) return [{ region, progress: { kind: "failed", message: failure } }];
      if (status === null) return [];
      const state = regionReadState(status, now);
      if (state === "reading" || state === "queued") return [{ region, progress: { kind: state } }];
      if (followedReads.has(region) && status.last_fulfilled !== null) {
        return [{ region, progress: { kind: "read", at: status.last_fulfilled.fulfilled_at } }];
      }
      return [];
    });

  const cards = (list: readonly ArrivalPost[]) => list.map((post) => (
    <ArrivalPostCard key={post.arrival_key} post={post} dateTime={dateTime} now={loadedAt} />
  ));

  const groupCount = (count: number) => {
    if (!windowComplete) return t("arrivals.groupPosts", { count });
    return count === 1 ? t("arrivals.postCountOne") : t("arrivals.postCount", { count });
  };

  return (
    <section className="mx-auto w-full max-w-7xl min-w-0 space-y-4" aria-labelledby="arrival-posts-title">
      <div className="space-y-1">
        <h1 id="arrival-posts-title" className="text-xl font-semibold sm:text-2xl">
          {t("arrivals.title")}
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("arrivals.subtitle")}
        </p>
      </div>

      <ArrivalRegionPanel regions={regionStatus} />

      {regionOptions !== null && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ArrivalRegionFilter
            options={regionOptions}
            selected={regions}
            onToggle={toggleRegion}
            onClear={clearRegions}
            recentWindow={recentWindow}
            requesting={requestingReads}
            failures={readFailures}
            now={now}
          />
        </div>
      )}

      <div className="grid min-w-0 gap-4 md:grid-cols-[16rem_minmax(0,1fr)] lg:grid-cols-[18rem_minmax(0,1fr)]">
        <ArrivalAccountPanel
          accounts={accounts}
          regionLabel={regionLabel}
          selected={selected}
          onSelect={select}
          state={sourcesState}
          postsFailed={error !== null}
          onRetry={() => void loadSources(cutoffISO(cutoff))}
          open={accountsOpen}
          onToggle={() => setAccountsOpen((open) => !open)}
          query={accountQuery}
          onQueryChange={setAccountQuery}
          recentWindow={recentWindow}
        />

        {/* Browser scroll anchoring is off here: a quiet refresh restores the
            reader's place itself (restoreScrollAnchor), on every browser. */}
        <div ref={feedRef} className="min-w-0 space-y-4 [overflow-anchor:none]">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              {selectedAccount ? (
                <>
                  <span className="text-muted-foreground">{t("arrivals.showingAccount")}</span>
                  <AccountIdentity
                    twitterHandle={selectedAccount.twitter_handle}
                    buyerHandle={selectedAccount.buyer_handle}
                  />
                  <Button variant="link" size="sm" className="h-auto min-h-0 px-0" onClick={() => select("")}>
                    {t("arrivals.showAllAccounts")}
                  </Button>
                </>
              ) : (
                <span className="font-medium">
                  {regionLabel ? t("arrivals.allAccountsInRegion", { region: regionLabel }) : t("arrivals.allAccounts")}
                </span>
              )}
              {!loading && !error && (
                <span className="text-muted-foreground tabular-nums">
                  {visible.length === 1
                    ? t("arrivals.loadedCountOne")
                    : t("arrivals.loadedCount", { count: visible.length })}
                </span>
              )}
              {!loading && loadingMore && (
                <span
                  className="flex items-center gap-1.5 text-muted-foreground"
                  role="status"
                  data-testid="arrival-window-loading"
                >
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                  {cutoff === null ? t("arrivals.loadingMore") : t("arrivals.loadingWindow")}
                </span>
              )}
              <ArrivalRegionReads reads={regionReads} now={now} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ArrivalWindowChips value={since} onChange={setWindow} />
              {!selected && (
                <Button
                  type="button"
                  variant={groupByAccount ? "secondary" : "outline"}
                  className="h-11 sm:h-8"
                  aria-pressed={groupByAccount}
                  onClick={() => setGrouping(!groupByAccount)}
                >
                  <LayoutList aria-hidden="true" />
                  {t("arrivals.groupByAccount")}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className="h-11 sm:h-8"
                disabled={loading}
                onClick={refresh}
              >
                <RefreshCw aria-hidden="true" />
                {t("arrivals.refresh")}
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
              <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
              {t("arrivals.loading")}
            </div>
          ) : error ? (
            <ArrivalLoadFailure
              error={error}
              title={t("arrivals.errorTitle")}
              onRetry={() => void load(selected, regions, null, false, cutoff)}
            />
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center" data-testid="arrival-empty">
              {hidden > 0 ? (
                <>
                  <p className="font-medium">
                    {t("arrivals.emptyWindowTitle", { window: t(`arrivals.windowLong.${since}`) })}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{t("arrivals.emptyWindowBody")}</p>
                  <Button className="mt-3 h-11 sm:h-8" variant="outline" onClick={() => setWindow("all")}>
                    {t("arrivals.showAllPosts")}
                  </Button>
                </>
              ) : (
                <>
                  <p className="font-medium">{t("arrivals.emptyTitle")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t("arrivals.emptyBody")}</p>
                </>
              )}
            </div>
          ) : groups ? (
            <div className="space-y-3" data-testid="arrival-post-groups">
              {groups.map((group) => {
                const open = !collapsed.has(group.buyer_handle);
                const headingId = `arrival-group-${encodeURIComponent(group.buyer_handle)}`;
                // Each account is a panel that scrolls on its own, with its
                // header pinned, so one prolific shop cannot push the others
                // off the page. The ring is inset because the panel clips.
                return (
                  <section
                    key={group.buyer_handle}
                    className="min-w-0 max-h-[60dvh] overflow-x-hidden overflow-y-auto rounded-xl border bg-card [overflow-anchor:none] md:max-h-[70dvh]"
                    aria-labelledby={headingId}
                    data-testid="arrival-account-group"
                    data-arrival-scroll
                  >
                    <h2 id={headingId} className={cn("sticky top-0 z-10 m-0 bg-card", open && "border-b")}>
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => toggleCollapsed(group.buyer_handle)}
                        className={cn(
                          "flex min-h-11 w-full min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-accent/50 focus-visible:ring-inset",
                          FOCUS_RING,
                        )}
                      >
                        {open ? (
                          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        )}
                        <AccountIdentity
                          twitterHandle={group.twitter_handle}
                          buyerHandle={group.buyer_handle}
                          className="min-w-0 flex-1"
                        />
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {groupCount(group.posts.length)} · {dateTime(group.latest_post_at)}
                        </span>
                      </button>
                    </h2>
                    {open && (
                      <div className="grid min-w-0 gap-4 p-3 md:grid-cols-2" data-testid="arrival-post-list">
                        {cards(group.posts)}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="grid min-w-0 gap-4 md:grid-cols-2" data-testid="arrival-post-list">
              {cards(visible)}
            </div>
          )}

          {!loading && !error && visible.length > 0 && (
            <div className="space-y-3">
              {loadMoreError && (
                <ArrivalLoadFailure
                  error={loadMoreError}
                  title={t("arrivals.moreErrorTitle")}
                  onRetry={() => void load(selected, regions, nextCursor, true, cutoff)}
                />
              )}
              {nextCursor && !loadMoreError && cutoff !== null && !loadingMore && (
                <p className="text-sm text-muted-foreground" data-testid="arrival-window-bound">
                  {t("arrivals.windowBoundNote")}
                </p>
              )}
              {nextCursor && !loadMoreError && (
                <Button
                  className="h-11 w-full sm:w-auto"
                  variant="outline"
                  disabled={loadingMore}
                  onClick={() => void load(selected, regions, nextCursor, true, cutoff)}
                >
                  {loadingMore ? (
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="size-4" aria-hidden="true" />
                  )}
                  {loadingMore ? t("arrivals.loadingMore") : t("arrivals.loadMore")}
                </Button>
              )}
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="note">
                <ImageIcon className="size-4" aria-hidden="true" />
                {t("arrivals.evidenceNote")}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
