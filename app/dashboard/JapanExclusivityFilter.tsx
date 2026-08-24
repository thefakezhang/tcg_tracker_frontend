"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/lib/i18n";
import type { JapanExclusivityMode } from "./japan-exclusivity";

export function JapanExclusivityFilter({
  value,
  onValueChange,
}: {
  value: JapanExclusivityMode;
  onValueChange: (value: JapanExclusivityMode) => void;
}) {
  const { t } = useTranslation();
  const labels: Record<JapanExclusivityMode, string> = {
    all: t("cardBrowser.jpExclusiveAll"),
    artwork: t("cardBrowser.jpExclusiveArtwork"),
    stamps: t("cardBrowser.jpExclusiveStamps"),
    either: t("cardBrowser.jpExclusiveEither"),
    both: t("cardBrowser.jpExclusiveBoth"),
    legacy: t("cardBrowser.jpExclusiveLegacy"),
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="japan-exclusivity-filter-trigger"
        render={<Button variant={value === "all" ? "outline" : "default"} className="h-11 shrink-0 sm:h-8" />}
      >
        {labels[value]}
        <ChevronDown className="ml-1 size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-w-[min(22rem,calc(100vw-2rem))]">
        <p className="max-w-xs whitespace-normal px-2 py-1.5 text-xs text-muted-foreground">
          {t("cardBrowser.jpExclusiveHint")}
        </p>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(nextValue) => onValueChange(nextValue as JapanExclusivityMode)}
        >
          {(Object.keys(labels) as JapanExclusivityMode[]).map((mode) => (
            <DropdownMenuRadioItem
              key={mode}
              className="min-h-11 whitespace-normal sm:min-h-8"
              value={mode}
            >
              {labels[mode]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
