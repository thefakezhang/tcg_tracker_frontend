"use client";

import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/dates";
import {
  EDHREC_TAG_DIMENSIONS,
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
  ].filter((group) => group.active);

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
            {group.url && (
              <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
          </>
        );
        const describedBy = `${group.label}: ${reason}${asOf ? ` (${t("mtgLabel.asOf", { date: asOf })})` : ""}`;
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

// The badge needs its OWN label, not the filter chip's. A chip is an
// instruction over the whole catalog and reads in the plural ("cEDH staples");
// a badge is a statement about the one card under it and reads in the singular.
function tagLabelKey(dimension: MtgEdhrecTagDimension) {
  return `mtgLabel.${dimension}` as const;
}
