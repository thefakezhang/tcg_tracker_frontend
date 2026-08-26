"use client";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import type { JapanExclusivityDimension } from "./japan-exclusivity";

const DIMENSIONS = ["artwork", "stamps"] as const;

export function JapanExclusivityFilter({
  selected,
  onToggle,
}: {
  selected: ReadonlySet<JapanExclusivityDimension>;
  onToggle: (dimension: JapanExclusivityDimension) => void;
}) {
  const { t } = useTranslation();
  const labels = {
    artwork: t("cardBrowser.jpExclusiveArtwork"),
    stamps: t("cardBrowser.jpExclusiveStamps"),
  } as const;

  return (
    <div
      role="group"
      aria-label={t("cardBrowser.jpExclusiveFilterLabel")}
      title={t("cardBrowser.jpExclusiveHint")}
      className="inline-flex min-w-0 self-start items-center gap-1"
      data-testid="japan-exclusivity-filter"
    >
      {DIMENSIONS.map((dimension) => {
        const active = selected.has(dimension);
        return (
          <Button
            key={dimension}
            type="button"
            variant={active ? "default" : "outline"}
            className="h-11 min-w-0 shrink-0 sm:h-8"
            aria-pressed={active}
            onClick={() => onToggle(dimension)}
            data-testid={`japan-exclusivity-${dimension}`}
          >
            {labels[dimension]}
          </Button>
        );
      })}
    </div>
  );
}
