"use client";

import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/lib/i18n";

interface EvidenceCard {
  japan_exclusive_artwork?: boolean | null;
  japan_exclusive_artwork_reason?: string | null;
  japan_exclusive_artwork_evidence_url?: string | null;
  japan_exclusive_stamps?: boolean | null;
  japan_exclusive_stamps_reason?: string | null;
  japan_exclusive_stamps_evidence_url?: string | null;
}

export function JapanExclusiveEvidence({
  card,
  compact = false,
}: {
  card: EvidenceCard;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const dimensions = [
    {
      key: "artwork",
      active: card.japan_exclusive_artwork === true,
      label: t("japanExclusive.artwork"),
      reason: card.japan_exclusive_artwork_reason,
      url: card.japan_exclusive_artwork_evidence_url,
    },
    {
      key: "stamps",
      active: card.japan_exclusive_stamps === true,
      label: t("japanExclusive.stamps"),
      reason: card.japan_exclusive_stamps_reason,
      url: card.japan_exclusive_stamps_evidence_url,
    },
  ].filter((dimension) => dimension.active);

  if (dimensions.length === 0) return null;
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-1 overflow-hidden" data-testid="japan-exclusive-evidence">
      {dimensions.map((dimension) => {
        const content = (
          <>
            <Badge variant="outline" className="h-auto shrink-0 px-1.5 py-px text-[10px]">
              {dimension.label}
            </Badge>
            <span className={compact ? "line-clamp-2 min-w-0 break-words text-[10px] leading-tight text-muted-foreground [overflow-wrap:anywhere]" : "min-w-0 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]"}>
              {dimension.reason || t("japanExclusive.evidenceUnavailable")}
            </span>
            {dimension.url && <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
          </>
        );
        return dimension.url ? (
          <a
            key={dimension.key}
            href={dimension.url}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 min-w-0 max-w-full items-start gap-1.5 overflow-hidden rounded-md border bg-muted/20 px-2 py-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
            aria-label={`${dimension.label}: ${dimension.reason || t("japanExclusive.evidenceUnavailable")}`}
            data-testid={`japan-exclusive-${dimension.key}`}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {content}
          </a>
        ) : (
          <div key={dimension.key} className="flex min-w-0 items-start gap-1.5" data-testid={`japan-exclusive-${dimension.key}`}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
