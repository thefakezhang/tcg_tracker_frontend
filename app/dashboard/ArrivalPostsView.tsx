"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useTranslation } from "@/lib/i18n";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import {
  type ArrivalAccountPost,
  type ArrivalSource,
  accountLabel,
  deriveArrivalSources,
  groupPostsByAccount,
  matchesAccountQuery,
  parseArrivalSources,
  readCollapsedAccounts,
  readGroupByAccount,
  sortArrivalSources,
  writeCollapsedAccounts,
  writeGroupByAccount,
} from "./arrival-accounts";
import {
  cutoffISO,
  pageExhaustsWindow,
  postsWithinWindow,
  readArrivalWindow,
  windowCutoff,
  writeArrivalWindow,
} from "./arrival-window";
import {
  ARRIVALS_SHOP_PARAM,
  ARRIVALS_WINDOW_PARAM,
  ARRIVAL_WINDOWS,
  type ArrivalWindow,
  DEFAULT_ARRIVAL_WINDOW,
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

export type ArrivalPostsLoader = (
  buyerHandle: string,
  cursor: ArrivalCursor | null,
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

export const loadArrivalPosts: ArrivalPostsLoader = async (buyerHandle, cursor) => {
  const query = new URLSearchParams({ limit: "100" });
  if (buyerHandle) query.set("buyer_handle", buyerHandle);
  if (cursor) {
    query.set("before", cursor.before);
    query.set("before_key", cursor.before_key);
  }
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
    <Card className="min-w-0" data-testid="arrival-post-card">
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

/** The window a link names, else the viewer's remembered choice (default 48 h). */
function readSelectedWindow(): ArrivalWindow {
  return parseWindowParam(readUrlParam(ARRIVALS_WINDOW_PARAM)) ?? readArrivalWindow();
}

export default function ArrivalPostsView({
  loader = loadArrivalPosts,
  sourcesLoader = loadArrivalSources,
}: {
  loader?: ArrivalPostsLoader;
  sourcesLoader?: ArrivalSourcesLoader;
}) {
  const { t, language } = useTranslation();
  // The selected shop is a leaf URL param (?shop=...) so one account's arrivals
  // can be linked and bookmarked; UrlStateSync drops it when the view changes.
  const [selected, setSelected] = useState(readSelectedShop);
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
  const [groupByAccount, setGroupByAccount] = useState(readGroupByAccount);
  const [collapsed, setCollapsed] = useState(readCollapsedAccounts);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [accountQuery, setAccountQuery] = useState("");
  const requestGeneration = useRef(0);
  const sourcesGeneration = useRef(0);

  useEffect(() => {
    writeUrlParam(ARRIVALS_SHOP_PARAM, selected || null);
  }, [selected]);

  useEffect(() => {
    writeUrlParam(ARRIVALS_WINDOW_PARAM, since === DEFAULT_ARRIVAL_WINDOW ? null : since);
  }, [since]);

  useEffect(() => {
    const onPop = () => {
      setSelected(readSelectedShop());
      setSince(readSelectedWindow());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // `cutoff` is the oldest observed time the window shows (null for All).
  // Pages arrive newest first, so once one ends past the cutoff, every row a
  // later page could return is older too, and paging stops there.
  const load = useCallback(async (
    buyerHandle: string,
    cursor: ArrivalCursor | null,
    append: boolean,
    cutoff: number | null,
  ) => {
    const generation = ++requestGeneration.current;
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
    try {
      const page = await loader(buyerHandle, cursor);
      if (requestGeneration.current !== generation) return;
      setPosts((current) => {
        if (!append) return page.posts;
        const known = new Set(current.map((post) => post.arrival_key));
        return [
          ...current,
          ...page.posts.filter((post) => {
            if (known.has(post.arrival_key)) return false;
            known.add(post.arrival_key);
            return true;
          }),
        ];
      });
      setSeen((current) => {
        const next = new Map(current);
        for (const post of page.posts) next.set(post.arrival_key, seenPost(post));
        return next;
      });
      setNextCursor(pageExhaustsWindow(page.posts, cutoff) ? null : page.nextCursor);
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

  const loadSources = useCallback(async (sinceISO: string | null) => {
    const generation = ++sourcesGeneration.current;
    setSourcesState({ status: "loading" });
    try {
      const sources = await sourcesLoader(sinceISO);
      if (sourcesGeneration.current !== generation) return;
      setSourcesState(sources === null ? { status: "fallback" } : { status: "ready", sources });
    } catch (reason) {
      if (sourcesGeneration.current !== generation) return;
      setSourcesState({ status: "error", error: asError(reason) });
    }
  }, [sourcesLoader]);

  const cutoff = useMemo(() => windowCutoff(since, loadedAt), [since, loadedAt]);

  // Both load effects key on `loadedAt`, not on `cutoff`: for All the cutoff is
  // null before and after a Refresh, and Refresh must still reload.
  useEffect(() => {
    void load(selected, null, false, windowCutoff(since, loadedAt));
  }, [selected, since, loadedAt, load]);

  // The same cutoff goes to the summary RPC as p_since, so each account's
  // recent count is the window's; All leaves the backend default (24 hours).
  useEffect(() => {
    void loadSources(cutoffISO(windowCutoff(since, loadedAt)));
  }, [since, loadedAt, loadSources]);

  const accounts = useMemo(() => {
    const list = sourcesState.status === "ready"
      ? sortArrivalSources(sourcesState.sources)
      : deriveArrivalSources(seen.values(), Date.now(), cutoff);
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
  }, [sourcesState, seen, selected, cutoff]);

  const selectedAccount = selected
    ? accounts.find((account) => account.buyer_handle === selected) ?? null
    : null;

  // The window applies here: the posts RPC has no since filter, but it orders
  // newest first, so dropping the rows past the cutoff is exact.
  const visible = useMemo(() => postsWithinWindow(posts, cutoff), [posts, cutoff]);
  const hidden = posts.length - visible.length;

  // Grouping the visible rows also leaves out the accounts with nothing in the window.
  const groups = useMemo(
    () => (groupByAccount && !selected ? groupPostsByAccount(visible) : null),
    [groupByAccount, selected, visible],
  );

  const select = (buyerHandle: string) => {
    setSelected(buyerHandle);
    setAccountsOpen(false);
  };

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

  const cards = (list: readonly ArrivalPost[]) => list.map((post) => (
    <ArrivalPostCard key={post.arrival_key} post={post} dateTime={dateTime} now={loadedAt} />
  ));

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

      <div className="grid min-w-0 gap-4 md:grid-cols-[16rem_minmax(0,1fr)] lg:grid-cols-[18rem_minmax(0,1fr)]">
        <ArrivalAccountPanel
          accounts={accounts}
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

        <div className="min-w-0 space-y-4">
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
                <span className="font-medium">{t("arrivals.allAccounts")}</span>
              )}
              {!loading && !error && (
                <span className="text-muted-foreground tabular-nums">
                  {visible.length === 1
                    ? t("arrivals.loadedCountOne")
                    : t("arrivals.loadedCount", { count: visible.length })}
                </span>
              )}
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
              onRetry={() => void load(selected, null, false, cutoff)}
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
                return (
                  <section
                    key={group.buyer_handle}
                    className="min-w-0 rounded-xl border bg-card"
                    aria-labelledby={headingId}
                    data-testid="arrival-account-group"
                  >
                    <h2 id={headingId} className="m-0">
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => toggleCollapsed(group.buyer_handle)}
                        className={cn(
                          "flex min-h-11 w-full min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-accent/50",
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
                          {t("arrivals.groupPosts", { count: group.posts.length })} · {dateTime(group.latest_post_at)}
                        </span>
                      </button>
                    </h2>
                    {open && (
                      <div className="grid min-w-0 gap-4 border-t p-3 md:grid-cols-2" data-testid="arrival-post-list">
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
                  onRetry={() => void load(selected, nextCursor, true, cutoff)}
                />
              )}
              {nextCursor && !loadMoreError && (
                <Button
                  className="h-11 w-full sm:w-auto"
                  variant="outline"
                  disabled={loadingMore}
                  onClick={() => void load(selected, nextCursor, true, cutoff)}
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
