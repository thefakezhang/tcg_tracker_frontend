"use client";

import { ArrowDownRight, ArrowUpRight, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/dates";
import {
  EDHREC_TAG_DIMENSIONS,
  FORMAT_PLAY_CODE,
  type FormatPlayTrend,
  type MtgFormatCode,
  FORMAT_PLAY_DIMENSIONS,
  formatPlayTrend,
  mtgTagColumn,
  type MtgEdhrecTagDimension,
  type MtgLabelProvenance,
  type MtgTagFlags,
} from "./mtg-tags";

// The MTG counterpart of JapanExclusiveEvidence: the label, the measurement
// behind it, and a link to the page it was measured from, wherever an MTG card
// is identified.
//
// ONE ROW PER WRITER, not per label. The three cEDH tags are set together by
// one weekly refresh from the ranking pages and share one reason; stockable is
// set by a separate job from the commanders' own pages. Splitting the cEDH tags
// into three rows would print the same sentence three times and imply the three
// were established independently, which they were not (migration 000564).
//
// THE DATE IS THE FEATURE. The Pokemon labels are curated identity facts and
// carry no date, because "this artwork was Japan-only" does not expire. These
// are weekly MEASUREMENTS, and 000564 exists precisely because a reader could
// not tell a staple from a stale flag. A row with no date is a label written
// before its provenance existed, and says so.
//
// THE TWO DECK COUNTS MEASURE DIFFERENT POPULATIONS and are deliberately not
// reconciled. The cEDH row counts decks on EDHREC's cEDH ranking pages; the
// stockable row counts decks across the top commanders' own pages, which is
// all of Commander. Rhystic Study reads "25,418 decks" on one row and "365,221
// decks across 56 commanders" on the other, and both are right. Do not unify
// them: the counts come from different pages on different cadences, which is
// why each row carries its own badge, link and date.
//
// THE FORMAT LABELS ARE ONE ROW PER FORMAT. mtgtop8 measures each format on its
// own page (migration 000664), so a card played in Modern and Legacy shows two
// rows with two shares and two links, and the arrow says whether the last two
// weeks run clearly ahead of or behind the two-month share.
export function MtgLabelEvidence({
  card,
  compact = false,
}: {
  card: MtgTagFlags & MtgLabelProvenance;
  compact?: boolean;
}) {
  const { t, language } = useTranslation();

  const activeTags = EDHREC_TAG_DIMENSIONS.filter(
    (dimension) => card[mtgTagColumn(dimension)] === true,
  );
  const groups = [
    {
      key: "edhrecTags",
      active: activeTags.length > 0,
      label: activeTags.map((dimension) => t(tagLabelKey(dimension))).join(" / "),
      reason: card.edhrec_tags_reason,
      url: card.edhrec_tags_evidence_url,
      asOf: card.edhrec_tags_as_of,
    },
    {
      key: "commanderDemand",
      active: card.is_commander_stockable === true,
      label: t("mtgLabel.stockable"),
      reason: card.commander_demand_reason,
      url: card.commander_demand_evidence_url,
      asOf: card.commander_demand_as_of,
    },
    ...FORMAT_PLAY_DIMENSIONS.map((dimension) => {
      const play = card.format_play?.[FORMAT_PLAY_CODE[dimension]];
      const trend = formatPlayTrend(play);
      return {
        key: `format-${FORMAT_PLAY_CODE[dimension]}`,
        active: card[mtgTagColumn(dimension)] === true,
        label: t(`mtgLabel.${dimension}`),
        reason: play?.reason,
        url: play?.url,
        asOf: play?.as_of,
        trend: trend?.direction ?? null,
        trendText: trendText(t, trend, FORMAT_PLAY_CODE[dimension]),
      };
    }),
  ].filter((group) => group.active) as EvidenceGroup[];

  if (groups.length === 0) return null;
  return (
    <div
      className="flex min-w-0 max-w-full flex-col gap-1 overflow-hidden"
      data-testid="mtg-label-evidence"
    >
      {groups.map((group) => {
        const asOf = formatDate(group.asOf, language);
        const reason = group.reason || t("mtgLabel.evidenceUnavailable");
        const content = (
          <>
            <Badge variant="outline" className="h-auto shrink-0 px-1.5 py-px text-[10px]">
              {group.label}
            </Badge>
            <span
              className={
                compact
                  ? "line-clamp-2 min-w-0 break-words text-[10px] leading-tight text-muted-foreground [overflow-wrap:anywhere]"
                  : "min-w-0 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]"
              }
            >
              {reason}
              {asOf && (
                // Parenthesised rather than its own element: it has to wrap
                // with the reason on a narrow grid tile, not drop to a line of
                // its own and push the price row down.
                <span className="whitespace-nowrap"> ({t("mtgLabel.asOf", { date: asOf })})</span>
              )}
            </span>
            {group.trend && (
              <span
                className={group.trend === "up" ? "shrink-0 text-emerald-600 dark:text-emerald-400" : "shrink-0 text-amber-600 dark:text-amber-400"}
                title={group.trendText ?? undefined}
                aria-label={group.trendText ?? undefined}
                role="img"
                data-testid={`mtg-label-${group.key}-trend-${group.trend}`}
              >
                {group.trend === "up"
                  ? <ArrowUpRight className="size-3" aria-hidden="true" />
                  : <ArrowDownRight className="size-3" aria-hidden="true" />}
              </span>
            )}
            {group.url && (
              <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
          </>
        );
        const describedBy = `${group.label}: ${reason}${asOf ? ` (${t("mtgLabel.asOf", { date: asOf })})` : ""}${group.trendText ? `. ${group.trendText}` : ""}`;
        return group.url ? (
          <a
            key={group.key}
            href={group.url}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 min-w-0 max-w-full items-center gap-1.5 overflow-hidden rounded-md border bg-muted/20 px-2 py-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
            aria-label={describedBy}
            data-testid={`mtg-label-${group.key}`}
            // The row sits inside a clickable table row and a clickable grid
            // tile; without this, following the evidence link also opens the
            // card detail modal behind it.
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {content}
          </a>
        ) : (
          <div
            key={group.key}
            className="flex min-w-0 items-center gap-1.5"
            data-testid={`mtg-label-${group.key}`}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

// The sentence behind a trend arrow, naming the board that moved. A cEDH
// "sideboard" is the command zone, so it reads as commanders there.
function trendText(
  t: ReturnType<typeof useTranslation>["t"],
  trend: FormatPlayTrend | null,
  code: MtgFormatCode,
): string | null {
  if (!trend) return null;
  if (trend.recent === null) return t("mtgLabel.trendGone");
  const board = trend.board === "main" ? "Main" : code === "cEDH" ? "Commander" : "Side";
  const key = `mtgLabel.trend${trend.direction === "up" ? "Up" : "Down"}${board}` as const;
  return t(key, { recent: String(trend.recent) });
}

interface EvidenceGroup {
  key: string;
  active: boolean;
  label: string;
  reason?: string | null;
  url?: string | null;
  asOf?: string | null;
  trend?: "up" | "down" | null;
  trendText?: string | null;
}

// The badge needs its OWN label, not the filter chip's. A chip is an
// instruction over the whole catalog and reads in the plural ("cEDH staples");
// a badge is a statement about the one card under it and reads in the singular.
function tagLabelKey(dimension: MtgEdhrecTagDimension) {
  return `mtgLabel.${dimension}` as const;
}

// The format labels as one line of small badges, for a table row where the
// full evidence rows above would be too tall (the inventory list). Each badge
// still carries its measurement: the reason and date in its title, the trend
// as an arrow, and a link to the mtgtop8 page it was read from.
//
// linked=false renders plain badges, for a badge row inside a control that is
// itself clickable (the inventory grid tile is a <button>, and a link nested
// in a button is invalid and steals the tap).
export function MtgFormatBadges({
  card,
  linked = true,
}: {
  card: MtgTagFlags & MtgLabelProvenance;
  linked?: boolean;
}) {
  const { t, language } = useTranslation();
  const active = FORMAT_PLAY_DIMENSIONS.filter((dimension) => card[mtgTagColumn(dimension)] === true);
  if (active.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid="mtg-format-badges">
      {active.map((dimension) => {
        const code = FORMAT_PLAY_CODE[dimension];
        const play = card.format_play?.[code];
        const trendDetail = formatPlayTrend(play);
        const trend = trendDetail?.direction ?? null;
        const asOf = formatDate(play?.as_of, language);
        const title = [
          `${t(`mtgLabel.${dimension}`)}: ${play?.reason || t("mtgLabel.evidenceUnavailable")}`,
          asOf ? `(${t("mtgLabel.asOf", { date: asOf })})` : "",
          trendText(t, trendDetail, code) ?? "",
        ].filter(Boolean).join(" ");
        const badge = (
          <Badge variant="outline" className="h-auto gap-0.5 px-1 py-px text-[10px]">
            {t(`mtgLabel.${dimension}`)}
            {trend === "up" && <ArrowUpRight className="size-3 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />}
            {trend === "down" && <ArrowDownRight className="size-3 text-amber-600 dark:text-amber-400" aria-hidden="true" />}
          </Badge>
        );
        return linked && play?.url ? (
          <a
            key={code}
            href={play.url}
            target="_blank"
            rel="noreferrer"
            title={title}
            aria-label={title}
            data-testid={`mtg-format-badge-${code}`}
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {badge}
          </a>
        ) : (
          <span key={code} title={title} aria-label={title} data-testid={`mtg-format-badge-${code}`}>{badge}</span>
        );
      })}
    </span>
  );
}
