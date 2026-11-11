"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  HandCoins,
  ImageIcon,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type TranslationKey, useTranslation } from "@/lib/i18n";
import { formatJpy } from "@/lib/money";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import {
  BUYBACK_FRESHNESS,
  BUYBACK_SORTS,
  type BuybackBox,
  type BuybackBuylist,
  type BuybackBuylistLoader,
  type BuybackFilters,
  type BuybackFreshness,
  type BuybackGradeFilter,
  type BuybackOverview,
  type BuybackOverviewLoader,
  type BuybackRow,
  type BuybackSort,
  type BuybackSource,
  type BuybackVerificationFilter,
  DEFAULT_BUYBACK_FILTERS,
  buybackPrintingLabel,
  countByFreshness,
  cropLayout,
  filterBuybackRows,
  lastChecked,
  loadBuybackBuylist,
  loadBuybackOverview,
  matchesSourceQuery,
  pollingProblems,
  sortBuybackRows,
} from "./twitter-buybacks";
import { BUYBACKS_SHOP_PARAM, parseShopParam, readUrlParam, writeUrlParam } from "./url-params";
import { classifyQueryError } from "./use-query";

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

type OverviewState =
  | { status: "loading" }
  | { status: "ready"; data: BuybackOverview }
  | { status: "unavailable" }
  | { status: "error"; error: Error };

type BuylistState =
  | { status: "idle" }
  | { status: "loading"; source: string }
  | { status: "ready"; data: BuybackBuylist }
  | { status: "unavailable" }
  | { status: "error"; source: string; error: Error };

/** Rows rendered at first and per Show more: a long buylist stays light on a phone. */
export const BUYLIST_PAGE = 100;

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
// Every control is a 44 px target on a phone and compact on a desk, as in Arrivals.
const TARGET = "min-h-11 sm:min-h-8";

const FRESHNESS_BADGE: Record<BuybackFreshness, string> = {
  fresh: "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  aging: "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  expired: "border-rose-500/50 bg-rose-500/10 text-rose-800 dark:text-rose-200",
};

// A badge is one nowrap line by default; these carry an account handle and a
// sentence, so they wrap instead of pushing the page sideways on a phone.
const WRAPPING_BADGE = "h-auto min-h-5 max-w-full whitespace-normal break-all text-left";

const FRESHNESS_DOT: Record<BuybackFreshness, string> = {
  fresh: "bg-emerald-500",
  aging: "bg-amber-500",
  expired: "bg-rose-500",
};

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

function readSelectedSource(): string {
  return parseShopParam(readUrlParam(BUYBACKS_SHOP_PARAM)) ?? "";
}

function useFormatters(now: number) {
  const { t, language } = useTranslation();
  const locale = language === "ja" ? "ja-JP" : "en-US";
  const jst = useCallback((value: string | null) => {
    if (value === null) return t("buybacks.unknownTime");
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return t("buybacks.unknownTime");
    const formatted = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Tokyo",
    }).format(parsed);
    return `${formatted} JST`;
  }, [locale, t]);
  const ago = useCallback((value: string | null) => (
    value === null ? t("buybacks.unknownTime") : relativeTime(value, now, locale) ?? t("buybacks.unknownTime")
  ), [locale, now, t]);
  const number = useCallback((value: number) => value.toLocaleString(locale), [locale]);
  return { t, language, jst, ago, number };
}

export function FreshnessBadge({
  freshness,
  at,
  now,
  className,
}: {
  freshness: BuybackFreshness;
  at: string | null;
  now: number;
  className?: string;
}) {
  const { t, ago } = useFormatters(now);
  return (
    <Badge
      variant="outline"
      className={cn(FRESHNESS_BADGE[freshness], className)}
      title={t("buybacks.freshnessHelp")}
      data-testid="buyback-freshness"
      data-freshness={freshness}
    >
      <span className={cn("size-2 rounded-full", FRESHNESS_DOT[freshness])} aria-hidden="true" />
      {t(`buybacks.freshness.${freshness}`)}
      {at !== null && <span className="font-normal">· {ago(at)}</span>}
    </Badge>
  );
}

function BuybackLoadFailure({ error, title, onRetry }: { error: Error; title: string; onRetry: () => void }) {
  const { t } = useTranslation();
  const kind = classifyQueryError(error);
  if (kind === "session-expired") {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4" role="alert">
        <p className="font-medium">{t("buybacks.sessionExpiredTitle")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("buybacks.sessionExpiredBody")}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <a
            href="/login"
            target="_blank"
            rel="noreferrer"
            className={cn("inline-flex items-center justify-center rounded-lg border bg-background px-4 text-sm font-medium hover:bg-accent", TARGET, FOCUS_RING)}
          >
            {t("buybacks.signInAgain")}
          </a>
          <Button className={TARGET} variant="outline" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            {t("buybacks.continueAfterSignIn")}
          </Button>
        </div>
      </div>
    );
  }
  if (kind === "forbidden") {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4" role="alert">
        <p className="font-medium">{t("buybacks.adminRequiredTitle")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("buybacks.adminRequiredBody")}</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4" role="alert">
      <p className="font-medium">{title}</p>
      <p className="mt-1 break-words text-sm text-muted-foreground">{error.message}</p>
      <Button className={cn("mt-3", TARGET)} variant="outline" onClick={onRetry}>
        <RefreshCw aria-hidden="true" />
        {t("buybacks.retry")}
      </Button>
    </div>
  );
}

function Unavailable() {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-dashed p-6 text-center" data-testid="buybacks-unavailable" role="status">
      <p className="font-medium">{t("buybacks.unavailableTitle")}</p>
      <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">{t("buybacks.unavailableBody")}</p>
    </div>
  );
}

function sheetSummary(t: Translate, number: (value: number) => string, source: BuybackSource): string {
  const sheet = source.latest_sheet;
  const cells = sheet.cells === 1 ? t("buybacks.cellsOne") : t("buybacks.cells", { count: number(sheet.cells) });
  const parts = ([
    ["auto_approved", sheet.auto_approved],
    ["approved", sheet.approved],
    ["pending", sheet.pending],
    ["rejected", sheet.rejected],
    ["expired", sheet.expired],
    ["misclassified", sheet.misclassified],
  ] as const)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => t(`buybacks.sheetStatus.${key}`, { count: number(value) }));
  return parts.length > 0
    ? t("buybacks.sheetSummary", { cells, parts: parts.join(t("buybacks.listSeparator")) })
    : cells;
}

// The sheet's cells by status, as one bar: how much of the latest sheet is
// verified, waiting, or thrown out, at a glance.
function SheetBar({ source }: { source: BuybackSource }) {
  const sheet = source.latest_sheet;
  if (sheet.cells === 0) return null;
  const segments: [number, string][] = [
    [sheet.auto_approved + sheet.approved, "bg-emerald-500"],
    [sheet.pending, "bg-amber-500"],
    [sheet.expired, "bg-rose-500/70"],
    [sheet.rejected + sheet.misclassified, "bg-muted-foreground/40"],
  ];
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
      {segments.filter(([value]) => value > 0).map(([value, color], index) => (
        <span key={index} className={color} style={{ width: `${(value / sheet.cells) * 100}%` }} />
      ))}
    </div>
  );
}

function AutoAcceptLine({ source, now }: { source: BuybackSource; now: number }) {
  const { t, number } = useFormatters(now);
  const state = source.auto_accept;
  if (!state.configured) {
    return <span className="text-muted-foreground">{t("buybacks.autoAccept.notConfigured")}</span>;
  }
  if (!state.enabled) {
    return <span className="text-muted-foreground">{t("buybacks.autoAccept.off")}</span>;
  }
  const use = state.daily_cap === null
    ? t("buybacks.autoAccept.usedToday", { used: number(state.used_today) })
    : t("buybacks.autoAccept.usedOfCap", { used: number(state.used_today), cap: number(state.daily_cap) });
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
      <span>{t("buybacks.autoAccept.on")}</span>
      <span className="text-muted-foreground">· {use}</span>
      {state.stale_fingerprint ? (
        <Badge
          variant="outline"
          className={cn("border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200", WRAPPING_BADGE)}
          title={t("buybacks.autoAccept.staleHelp")}
          data-testid="buyback-fingerprint-stale"
        >
          <ShieldAlert aria-hidden="true" />
          {t("buybacks.autoAccept.stale")}
        </Badge>
      ) : state.fingerprint_current === true ? (
        <Badge variant="outline" className="text-muted-foreground" data-testid="buyback-fingerprint-current">
          <ShieldCheck aria-hidden="true" />
          {t("buybacks.autoAccept.current")}
        </Badge>
      ) : null}
    </span>
  );
}

function PollingLine({ source, now }: { source: BuybackSource; now: number }) {
  const { t, ago, jst } = useFormatters(now);
  const checked = lastChecked(source);
  const problems = pollingProblems(source);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
      <span title={checked === null ? undefined : jst(checked)}>
        {checked === null ? t("buybacks.neverChecked") : t("buybacks.checked", { when: ago(checked) })}
      </span>
      {problems.map((problem) => (
        <Badge
          key={problem.account}
          variant="outline"
          className={cn("border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200", WRAPPING_BADGE)}
          data-testid="buyback-polling-problem"
        >
          @{problem.account}:{" "}
          {problem.status === "active"
            ? t("buybacks.polling.failing", { count: problem.consecutive_failures })
            : (["paused", "suspended_account", "disabled_config"].includes(problem.status)
              ? t(`buybacks.polling.${problem.status as "paused" | "suspended_account" | "disabled_config"}`)
              : problem.status)}
        </Badge>
      ))}
    </span>
  );
}

function SourceDetails({ source, now }: { source: BuybackSource; now: number }) {
  const { t, jst, number } = useFormatters(now);
  const latest = source.latest_tweet;
  const buylist = source.buylist;
  return (
    <dl className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm sm:grid-cols-[7rem_minmax(0,1fr)]">
      <dt className="text-muted-foreground">{t("buybacks.latestTweet")}</dt>
      <dd className="min-w-0 break-words">
        <span>{jst(latest.tweeted_at)}</span>{" "}
        <span className="text-muted-foreground">{t("buybacks.postedBy", { account: latest.account })}</span>{" "}
        <a
          href={latest.tweet_url}
          target="_blank"
          rel="noreferrer noopener"
          className={cn("inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline", FOCUS_RING)}
        >
          {t("buybacks.openPost")}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
        <span className="block text-xs text-muted-foreground">
          {latest.read_at === null ? t("buybacks.notRead") : t("buybacks.readAt", { when: jst(latest.read_at) })}
        </span>
        <span className="block text-xs text-muted-foreground">
          {t("buybacks.tweetsRecent", { day: number(source.tweets_24h), threeDays: number(source.tweets_72h) })}
        </span>
      </dd>
      <dt className="text-muted-foreground">{t("buybacks.latestSheet")}</dt>
      <dd className="min-w-0 space-y-1">
        <span className="block break-words">{sheetSummary(t, number, source)}</span>
        <SheetBar source={source} />
      </dd>
      <dt className="text-muted-foreground">{t("buybacks.buylistLabel")}</dt>
      <dd className="min-w-0">
        <span className={cn("font-medium tabular-nums", buylist.live_bids === 0 && "text-muted-foreground")}>
          {t("buybacks.liveBids", { count: number(buylist.live_bids) })}
        </span>
        <span className="text-muted-foreground">
          {" · "}
          {t("buybacks.liveCards", { live: number(buylist.live_cards), cards: number(buylist.cards) })}
        </span>
      </dd>
      <dt className="text-muted-foreground">{t("buybacks.autoAcceptLabel")}</dt>
      <dd className="min-w-0"><AutoAcceptLine source={source} now={now} /></dd>
      <dt className="text-muted-foreground">{t("buybacks.pollingLabel")}</dt>
      <dd className="min-w-0"><PollingLine source={source} now={now} /></dd>
    </dl>
  );
}

function SourceHeading({ source, now, as: Heading = "h3" }: { source: BuybackSource; now: number; as?: "h2" | "h3" }) {
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <Heading className="break-all text-base font-semibold">{source.source}</Heading>
        <p className="break-all text-xs text-muted-foreground">
          {source.accounts.map((account) => `@${account}`).join(" · ")}
        </p>
      </div>
      <FreshnessBadge freshness={source.freshness} at={source.latest_tweet.tweeted_at} now={now} />
    </div>
  );
}

function SourceCard({ source, now, onOpen }: { source: BuybackSource; now: number; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <li
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4"
      data-testid="buyback-source-card"
      data-source={source.source}
    >
      <SourceHeading source={source} now={now} />
      <SourceDetails source={source} now={now} />
      <Button type="button" variant="outline" className={cn("mt-auto w-full sm:w-auto sm:self-start", TARGET)} onClick={onOpen}>
        {t("buybacks.openBuylist")}
      </Button>
    </li>
  );
}

function SourcePanel({
  sources,
  selected,
  onSelect,
  open,
  onToggle,
  query,
  onQueryChange,
  now,
}: {
  sources: BuybackSource[];
  selected: string;
  onSelect: (source: string) => void;
  open: boolean;
  onToggle: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  now: number;
}) {
  const { t, ago, number } = useFormatters(now);
  const visible = sources.filter((source) => matchesSourceQuery(source, query));
  return (
    <aside className="min-w-0 md:sticky md:top-4 md:self-start" aria-labelledby="buyback-sources-title">
      <div className="rounded-xl border bg-card">
        <div className="flex min-h-11 items-center justify-between gap-2 px-3 py-1.5">
          <h2 id="buyback-sources-title" className="flex items-center gap-2 text-sm font-semibold">
            <HandCoins className="size-4 text-muted-foreground" aria-hidden="true" />
            {t("buybacks.sourcesTitle")}
            <span className="font-normal text-muted-foreground tabular-nums">({sources.length})</span>
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 md:hidden"
            aria-expanded={open}
            aria-controls="buyback-source-list"
            onClick={onToggle}
          >
            {open ? t("buybacks.hideSources") : t("buybacks.showSources")}
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
          </Button>
        </div>
        <div id="buyback-source-list" className={cn("space-y-2 border-t p-2", open ? "block" : "hidden md:block")}>
          <Input
            type="search"
            aria-label={t("buybacks.sourceSearch")}
            placeholder={t("buybacks.sourceSearchPlaceholder")}
            className="h-11 sm:h-8"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            autoComplete="off"
          />
          <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto md:max-h-[calc(100dvh-14rem)]" data-testid="buyback-sources">
            <li>
              <button
                type="button"
                aria-pressed={selected === ""}
                onClick={() => onSelect("")}
                className={cn(
                  "flex min-h-11 w-full items-center rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent sm:min-h-9",
                  FOCUS_RING,
                  selected === "" && "bg-accent font-medium",
                )}
              >
                {t("buybacks.allSources")}
              </button>
            </li>
            {visible.map((source) => (
              <li key={source.source}>
                <button
                  type="button"
                  aria-pressed={selected === source.source}
                  onClick={() => onSelect(source.source)}
                  className={cn(
                    "flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent sm:min-h-9",
                    FOCUS_RING,
                    selected === source.source && "bg-accent font-medium",
                  )}
                >
                  <span
                    className={cn("size-2 shrink-0 rounded-full", FRESHNESS_DOT[source.freshness])}
                    title={t(`buybacks.freshness.${source.freshness}`)}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{source.source}</span>
                    <span className="block truncate text-xs font-normal text-muted-foreground">
                      {source.accounts.map((account) => `@${account}`).join(", ")}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end text-xs tabular-nums">
                    <span className="sr-only">{t(`buybacks.freshness.${source.freshness}`)}</span>
                    <span className="font-normal text-muted-foreground">{ago(source.latest_tweet.tweeted_at)}</span>
                    <span className={source.buylist.live_bids > 0 ? "text-foreground" : "text-muted-foreground"}>
                      {t("buybacks.liveShort", { count: number(source.buylist.live_bids) })}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {query.trim() !== "" && visible.length === 0 && (
            <p className="px-2 text-xs text-muted-foreground">{t("buybacks.sourcesNoMatch")}</p>
          )}
        </div>
      </div>
    </aside>
  );
}

function ChipGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  render,
  testId,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  render: (value: T) => string;
  testId: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1" data-testid={testId}>
      {options.map((option) => (
        <Button
          key={option}
          type="button"
          variant={option === value ? "secondary" : "outline"}
          className="h-11 px-3 sm:h-8"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
        >
          {render(option)}
        </Button>
      ))}
    </div>
  );
}

// One box of the sheet, drawn from the public source image. `object-fit:
// none` shows the image at its natural size, the negative position puts the
// box's corner at the origin, and the scale fits the box inside the frame.
// The image loads lazily, so a long buylist fetches only the sheets in view.
function SheetCrop({
  imageURL,
  box,
  maxWidth,
  maxHeight,
  alt,
}: {
  imageURL: string;
  box: BuybackBox;
  maxWidth: number;
  maxHeight: number;
  alt: string;
}) {
  const layout = cropLayout(box, maxWidth, maxHeight);
  return (
    <span
      className="block overflow-hidden rounded bg-muted"
      style={{ width: `${layout.frameWidth}px`, height: `${layout.frameHeight}px` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageURL}
        alt={alt}
        loading="lazy"
        decoding="async"
        draggable={false}
        style={{
          width: `${layout.imageWidth}px`,
          height: `${layout.imageHeight}px`,
          objectFit: "none",
          objectPosition: `-${layout.offsetX}px -${layout.offsetY}px`,
          transformOrigin: "top left",
          transform: `scale(${layout.scale})`,
          maxWidth: "none",
          maxHeight: "none",
        }}
      />
    </span>
  );
}

function RowCrops({ row, name }: { row: BuybackRow; name: string }) {
  const { t } = useTranslation();
  const sheet = row.sheet;
  if (sheet === null || sheet.card === null) {
    return (
      <span className="flex h-24 w-16 items-center justify-center rounded bg-muted text-center text-[10px] text-muted-foreground">
        <ImageIcon className="size-4" aria-hidden="true" />
        <span className="sr-only">{t("buybacks.noCrop")}</span>
      </span>
    );
  }
  return (
    <a
      href={sheet.image_url}
      target="_blank"
      rel="noreferrer noopener"
      className={cn("flex w-16 flex-col items-center gap-1 rounded", FOCUS_RING)}
      aria-label={t("buybacks.openSheet", { card: name })}
      data-testid="buyback-crop"
    >
      <SheetCrop imageURL={sheet.image_url} box={sheet.card} maxWidth={64} maxHeight={88}
        alt={t("buybacks.cropCard", { card: name })} />
      {sheet.price !== null && (
        <SheetCrop imageURL={sheet.image_url} box={sheet.price} maxWidth={64} maxHeight={24}
          alt={t("buybacks.cropPrice")} />
      )}
    </a>
  );
}

function BuylistRow({ row, now }: { row: BuybackRow; now: number }) {
  const { t, language, jst } = useFormatters(now);
  const card = row.card;
  const name = language === "en" && card.english_name ? card.english_name : card.name;
  const otherName = language === "en" && card.english_name ? card.name : card.english_name;
  const setName = language === "en" && card.set_english_name ? card.set_english_name : card.set_name;
  const printing = buybackPrintingLabel(card);
  const setLine = [setName, card.set_code, card.card_number ? `No. ${card.card_number}` : null, printing]
    .filter(Boolean)
    .join(" · ");
  const corrected = row.verified && row.price_jpy !== row.read_price_jpy;
  return (
    <li
      className="grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] gap-3 p-3"
      data-testid="buyback-row"
      data-card-id={card.card_id}
      data-grade={row.grade}
    >
      <RowCrops row={row} name={name} />
      <div className="min-w-0 space-y-1.5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1 basis-48">
            <p className="break-words font-medium" lang={name === card.name ? "ja" : undefined}>{name}</p>
            {otherName && otherName !== name && (
              <p className="break-words text-xs text-muted-foreground" lang={otherName === card.name ? "ja" : undefined}>
                {otherName}
              </p>
            )}
            <p className="break-words text-xs text-muted-foreground">{setLine}</p>
          </div>
          {/* Beside the name on a desk; on a phone it wraps under the name and
              reads left to right, price first. */}
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 sm:shrink-0 sm:flex-col sm:items-end sm:text-right">
            <span className="text-lg font-semibold tabular-nums" data-testid="buyback-price">{formatJpy(row.price_jpy)}</span>
            {row.verified ? (
              <Badge variant="outline" className="border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200">
                <ShieldCheck aria-hidden="true" />
                {t(row.status === "approved" ? "buybacks.rowApproved" : "buybacks.rowAutoAccepted")}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className={row.status === "expired"
                  ? "text-muted-foreground"
                  : "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200"}
                title={t("buybacks.reviewHelp")}
              >
                {t(row.status === "expired" ? "buybacks.rowNeverReviewed" : "buybacks.rowInReview")}
              </Badge>
            )}
            {corrected && (
              <span className="text-xs text-muted-foreground" data-testid="buyback-read-price">
                {t("buybacks.readPrice", { price: formatJpy(row.read_price_jpy) })}
              </span>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <Badge variant={row.grade === "psa_10" ? "secondary" : "outline"}>{t(`buybacks.grade.${row.grade}`)}</Badge>
          <FreshnessBadge freshness={row.freshness} at={row.quoted_at} now={now} />
          <span className="text-muted-foreground">{t("buybacks.quoted", { when: jst(row.quoted_at) })}</span>
          <span className="flex flex-wrap items-center gap-x-2">
            {row.tweets.map((tweet) => (
              <a
                key={tweet.tweet_id}
                href={tweet.tweet_url}
                target="_blank"
                rel="noreferrer noopener"
                className={cn("inline-flex min-h-11 items-center gap-1 text-primary underline-offset-2 hover:underline sm:min-h-0", FOCUS_RING)}
                aria-label={t("buybacks.openTweet", { account: tweet.account, when: jst(tweet.tweeted_at) })}
                title={jst(tweet.tweeted_at)}
              >
                @{tweet.account}
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            ))}
          </span>
        </div>
      </div>
    </li>
  );
}

function BuylistPanel({
  state,
  now,
  onRetry,
  onShowAll,
}: {
  state: BuylistState;
  now: number;
  onRetry: () => void;
  onShowAll: () => void;
}) {
  const { t, jst, ago, number } = useFormatters(now);
  const [filters, setFilters] = useState<BuybackFilters>(DEFAULT_BUYBACK_FILTERS);
  const [sort, setSort] = useState<BuybackSort>("newest");
  const [shown, setShown] = useState(BUYLIST_PAGE);
  const rows = state.status === "ready" ? state.data.rows : null;
  const visible = useMemo(
    () => (rows === null ? [] : sortBuybackRows(filterBuybackRows(rows, filters), sort)),
    [rows, filters, sort],
  );

  // A new buylist or a new filter starts from the top again. This is adjusted
  // while rendering, not in an effect: an effect ran after the list appeared,
  // so a Show more pressed before it ran was undone (the flaky "renders a long
  // buylist a page at a time" test).
  const [shownFor, setShownFor] = useState({ rows, filters, sort });
  if (shownFor.rows !== rows || shownFor.filters !== filters || shownFor.sort !== sort) {
    setShownFor({ rows, filters, sort });
    setShown(BUYLIST_PAGE);
  }

  if (state.status === "loading" || state.status === "idle") {
    return (
      <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
        {t("buybacks.loadingBuylist")}
      </div>
    );
  }
  if (state.status === "unavailable") return <Unavailable />;
  if (state.status === "error") {
    return <BuybackLoadFailure error={state.error} title={t("buybacks.buylistErrorTitle")} onRetry={onRetry} />;
  }

  const buylist = state.data;
  if (!buylist.known) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center" data-testid="buyback-unknown-source">
        <p className="font-medium break-all">{t("buybacks.unknownTitle", { source: buylist.source })}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("buybacks.unknownBody")}</p>
        <Button className={cn("mt-3", TARGET)} variant="outline" onClick={onShowAll}>
          {t("buybacks.backToAll")}
        </Button>
      </div>
    );
  }

  const verifiedCount = buylist.rows.filter((row) => row.verified).length;
  const filtered = filters.grade !== "all" || filters.verification !== "all" || filters.query.trim() !== "";
  const allExpired = buylist.rows.length > 0 && buylist.rows.every((row) => row.freshness === "expired");

  return (
    <section className="min-w-0 space-y-3" aria-labelledby="buyback-buylist-title">
      <div className="space-y-1">
        <h2 id="buyback-buylist-title" className="text-base font-semibold">{t("buybacks.buylistTitle")}</h2>
        {buylist.window_started_at !== null && buylist.latest_tweet_at !== null && (
          <p className="text-xs text-muted-foreground">
            {t("buybacks.buylistWindow", { from: jst(buylist.window_started_at), to: jst(buylist.latest_tweet_at) })}
          </p>
        )}
      </div>
      {allExpired && buylist.latest_tweet_at !== null && (
        <p
          className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 text-sm text-rose-800 dark:text-rose-200"
          role="note"
          data-testid="buyback-all-expired"
        >
          {t("buybacks.allExpired", { when: jst(buylist.latest_tweet_at), ago: ago(buylist.latest_tweet_at) })}
        </p>
      )}
      <div className="space-y-2 rounded-xl border bg-card p-3">
        <Input
          type="search"
          aria-label={t("buybacks.searchLabel")}
          placeholder={t("buybacks.searchPlaceholder")}
          className="h-11 sm:h-8"
          value={filters.query}
          onChange={(event) => setFilters({ ...filters, query: event.target.value })}
          autoComplete="off"
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ChipGroup<BuybackGradeFilter>
            label={t("buybacks.gradeLabel")}
            value={filters.grade}
            options={["all", "raw", "psa_10"]}
            onChange={(grade) => setFilters({ ...filters, grade })}
            render={(grade) => t(`buybacks.grade.${grade}`)}
            testId="buyback-grade-filter"
          />
          <ChipGroup<BuybackVerificationFilter>
            label={t("buybacks.verificationLabel")}
            value={filters.verification}
            options={["all", "verified", "review"]}
            onChange={(verification) => setFilters({ ...filters, verification })}
            render={(verification) => t(`buybacks.verification.${verification}`)}
            testId="buyback-verification-filter"
          />
          <ChipGroup<BuybackSort>
            label={t("buybacks.sortLabel")}
            value={sort}
            options={BUYBACK_SORTS}
            onChange={setSort}
            render={(option) => t(`buybacks.sort.${option}`)}
            testId="buyback-sort"
          />
        </div>
        <p className="text-xs text-muted-foreground tabular-nums" data-testid="buyback-row-count" aria-live="polite">
          {t("buybacks.rowCount", { shown: number(visible.length), total: number(buylist.rows.length) })}
          {" · "}
          {t("buybacks.verifiedCount", { count: number(verifiedCount) })}
        </p>
      </div>

      {buylist.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center" data-testid="buyback-empty-buylist">
          <p className="font-medium">{t("buybacks.emptyBuylistTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("buybacks.emptyBuylistBody")}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center" data-testid="buyback-no-match">
          <p className="font-medium">{t("buybacks.noMatchTitle")}</p>
          {filtered && (
            <Button
              className={cn("mt-3", TARGET)}
              variant="outline"
              onClick={() => setFilters(DEFAULT_BUYBACK_FILTERS)}
            >
              {t("buybacks.clearFilters")}
            </Button>
          )}
        </div>
      ) : (
        <>
          <ul className="min-w-0 divide-y rounded-xl border bg-card" data-testid="buyback-rows">
            {visible.slice(0, shown).map((row) => (
              <BuylistRow key={`${row.card.card_id}:${row.grade}`} row={row} now={now} />
            ))}
          </ul>
          {visible.length > shown && (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full sm:w-auto"
              onClick={() => setShown((current) => current + BUYLIST_PAGE)}
            >
              {t("buybacks.showMore", { count: number(Math.min(BUYLIST_PAGE, visible.length - shown)) })}
            </Button>
          )}
        </>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="note">
        <ImageIcon className="size-4 shrink-0" aria-hidden="true" />
        {t("buybacks.evidenceNote")}
      </p>
    </section>
  );
}

export default function TwitterBuybacksView({
  overviewLoader = loadBuybackOverview,
  buylistLoader = loadBuybackBuylist,
  now: clock = Date.now,
}: {
  overviewLoader?: BuybackOverviewLoader;
  buylistLoader?: BuybackBuylistLoader;
  now?: () => number;
}) {
  const [selected, setSelected] = useState(readSelectedSource);
  const [overview, setOverview] = useState<OverviewState>({ status: "loading" });
  const [buylist, setBuylist] = useState<BuylistState>({ status: "idle" });
  // When the tab was (re)loaded: every age on it is measured from this moment.
  const [loadedAt, setLoadedAt] = useState(clock);
  const [freshnessFilter, setFreshnessFilter] = useState<"all" | BuybackFreshness>("all");
  const [sourceQuery, setSourceQuery] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const overviewGeneration = useRef(0);
  const buylistGeneration = useRef(0);
  const { t, jst, number } = useFormatters(loadedAt);

  useEffect(() => {
    writeUrlParam(BUYBACKS_SHOP_PARAM, selected || null);
  }, [selected]);

  useEffect(() => {
    const onPop = () => setSelected(readSelectedSource());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const loadOverview = useCallback(async () => {
    const generation = ++overviewGeneration.current;
    setOverview({ status: "loading" });
    try {
      const data = await overviewLoader();
      if (overviewGeneration.current !== generation) return;
      setOverview(data === null ? { status: "unavailable" } : { status: "ready", data });
    } catch (reason) {
      if (overviewGeneration.current !== generation) return;
      setOverview({ status: "error", error: asError(reason) });
    }
  }, [overviewLoader]);

  const loadBuylist = useCallback(async (source: string) => {
    const generation = ++buylistGeneration.current;
    if (source === "") {
      setBuylist({ status: "idle" });
      return;
    }
    setBuylist({ status: "loading", source });
    try {
      const data = await buylistLoader(source);
      if (buylistGeneration.current !== generation) return;
      setBuylist(data === null ? { status: "unavailable" } : { status: "ready", data });
    } catch (reason) {
      if (buylistGeneration.current !== generation) return;
      setBuylist({ status: "error", source, error: asError(reason) });
    }
  }, [buylistLoader]);

  useEffect(() => {
    void loadOverview();
  }, [loadedAt, loadOverview]);

  useEffect(() => {
    void loadBuylist(selected);
  }, [selected, loadedAt, loadBuylist]);

  const refresh = () => setLoadedAt((previous) => Math.max(clock(), previous + 1));

  const select = (source: string) => {
    setSelected(source);
    setPanelOpen(false);
  };

  const sources = overview.status === "ready" ? overview.data.sources : [];
  const counts = useMemo(() => countByFreshness(sources), [sources]);
  const selectedSource = selected ? sources.find((source) => source.source === selected) ?? null : null;
  const shownSources = freshnessFilter === "all"
    ? sources
    : sources.filter((source) => source.freshness === freshnessFilter);

  const header = (
    <div className="space-y-1">
      <h1 id="buybacks-title" className="text-xl font-semibold sm:text-2xl">{t("buybacks.title")}</h1>
      <p className="max-w-3xl text-sm text-muted-foreground">{t("buybacks.subtitle")}</p>
    </div>
  );

  if (overview.status === "unavailable" || buylist.status === "unavailable") {
    return (
      <section className="mx-auto w-full max-w-7xl min-w-0 space-y-4" aria-labelledby="buybacks-title">
        {header}
        <Unavailable />
      </section>
    );
  }

  const global = overview.status === "ready" ? overview.data.auto_accept : null;

  return (
    <section className="mx-auto w-full max-w-7xl min-w-0 space-y-4" aria-labelledby="buybacks-title">
      {header}

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-testid="buybacks-summary">
          {overview.status === "ready" ? (
            <>
              <span className="font-medium tabular-nums">
                {t("buybacks.sourceCount", { count: number(sources.length) })}
              </span>
              {BUYBACK_FRESHNESS.map((band) => (
                <span key={band} className="flex items-center gap-1.5 tabular-nums text-muted-foreground">
                  <span className={cn("size-2 rounded-full", FRESHNESS_DOT[band])} aria-hidden="true" />
                  {t(`buybacks.freshnessCount.${band}`, { count: number(counts[band]) })}
                </span>
              ))}
              {global !== null && (
                <span className={cn("text-muted-foreground", !global.global_enabled && "text-amber-800 dark:text-amber-200")}>
                  {global.global_enabled
                    ? (global.global_daily_cap === null
                      ? t("buybacks.globalOn", { used: number(global.global_used_today) })
                      : t("buybacks.globalOnCap", {
                        used: number(global.global_used_today),
                        cap: number(global.global_daily_cap),
                        since: jst(overview.data.cap_day_started_at),
                      }))
                    : t("buybacks.globalOff")}
                </span>
              )}
            </>
          ) : overview.status === "loading" ? (
            <span className="flex items-center gap-1.5 text-muted-foreground" role="status">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              {t("buybacks.loading")}
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          className={TARGET}
          disabled={overview.status === "loading"}
          onClick={refresh}
        >
          <RefreshCw aria-hidden="true" />
          {t("buybacks.refresh")}
        </Button>
      </div>

      {overview.status === "error" && (
        <BuybackLoadFailure error={overview.error} title={t("buybacks.errorTitle")} onRetry={() => void loadOverview()} />
      )}

      {overview.status === "loading" && !selected && (
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          {t("buybacks.loading")}
        </div>
      )}

      {overview.status === "ready" && sources.length === 0 && !selected ? (
        <div className="rounded-xl border border-dashed p-8 text-center" data-testid="buybacks-empty">
          <p className="font-medium">{t("buybacks.emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("buybacks.emptyBody")}</p>
        </div>
      ) : (overview.status === "ready" || selected) && (
        <div className="grid min-w-0 gap-4 md:grid-cols-[16rem_minmax(0,1fr)] lg:grid-cols-[18rem_minmax(0,1fr)]">
          {overview.status === "ready" ? (
            <SourcePanel
              sources={sources}
              selected={selected}
              onSelect={select}
              open={panelOpen}
              onToggle={() => setPanelOpen((open) => !open)}
              query={sourceQuery}
              onQueryChange={setSourceQuery}
              now={loadedAt}
            />
          ) : (
            <div className="hidden md:block" aria-hidden="true" />
          )}

          <div className="min-w-0 space-y-4">
            {selected ? (
              <>
                <Button type="button" variant="ghost" className={cn("px-2", TARGET)} onClick={() => select("")}>
                  <ArrowLeft aria-hidden="true" />
                  {t("buybacks.backToAll")}
                </Button>
                {selectedSource && (
                  <div className="space-y-3 rounded-xl border bg-card p-4" data-testid="buyback-source-detail">
                    <SourceHeading source={selectedSource} now={loadedAt} as="h2" />
                    <SourceDetails source={selectedSource} now={loadedAt} />
                  </div>
                )}
                <BuylistPanel
                  key={selected}
                  state={buylist}
                  now={loadedAt}
                  onRetry={() => void loadBuylist(selected)}
                  onShowAll={() => select("")}
                />
              </>
            ) : (
              <>
                <ChipGroup<"all" | BuybackFreshness>
                  label={t("buybacks.freshnessFilter")}
                  value={freshnessFilter}
                  options={["all", ...BUYBACK_FRESHNESS]}
                  onChange={setFreshnessFilter}
                  render={(band) => band === "all"
                    ? t("buybacks.freshnessAll", { count: number(sources.length) })
                    : t(`buybacks.freshnessCount.${band}`, { count: number(counts[band]) })}
                  testId="buyback-freshness-filter"
                />
                {shownSources.length === 0 ? (
                  <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    {t("buybacks.noSourcesInBand")}
                  </p>
                ) : (
                  <ul className="grid min-w-0 gap-4 xl:grid-cols-2" data-testid="buyback-source-cards">
                    {shownSources.map((source) => (
                      <SourceCard
                        key={source.source}
                        source={source}
                        now={loadedAt}
                        onOpen={() => select(source.source)}
                      />
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
