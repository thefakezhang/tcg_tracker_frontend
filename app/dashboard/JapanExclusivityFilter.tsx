"use client";

import { useId } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
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
  const hintId = useId();
  const labels: Record<JapanExclusivityMode, string> = {
    all: t("cardBrowser.jpExclusiveAll"),
    artwork: t("cardBrowser.jpExclusiveArtwork"),
    stamps: t("cardBrowser.jpExclusiveStamps"),
    either: t("cardBrowser.jpExclusiveEither"),
    both: t("cardBrowser.jpExclusiveBoth"),
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="japan-exclusivity-filter-trigger"
        aria-label={`${t("cardBrowser.jpExclusiveFilterLabel")}: ${labels[value]}`}
        aria-describedby={hintId}
        title={t("cardBrowser.jpExclusiveHint")}
        render={(
          <Button
            variant={value === "all" ? "outline" : "default"}
            className="h-11 w-full min-w-0 justify-between gap-2 sm:h-8 sm:w-auto"
          />
        )}
      >
        <span className="min-w-0 truncate">
          <span className={value === "all" ? "text-muted-foreground" : "text-primary-foreground/75"}>
            {t("cardBrowser.jpExclusiveFilterLabel")}
          </span>
          <span aria-hidden="true"> · </span>
          <span>{labels[value]}</span>
        </span>
        <ChevronDown className="size-4 shrink-0" />
      </DropdownMenuTrigger>
      <span className="sr-only" id={hintId}>{t("cardBrowser.jpExclusiveHint")}</span>
      <DropdownMenuContent className="w-56 max-w-[calc(100vw-2rem)]">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1.5 uppercase tracking-wide">
            {t("cardBrowser.jpExclusiveFilterLabel")}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(nextValue) => onValueChange(nextValue as JapanExclusivityMode)}
          >
            {(Object.keys(labels) as JapanExclusivityMode[]).map((mode) => (
              <DropdownMenuRadioItem
                key={mode}
                className="min-h-11 px-2 sm:min-h-9"
                value={mode}
              >
                {labels[mode]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
