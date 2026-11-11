"use client";

// The Arrivals region filter: one dropdown that mixes and matches the regions
// the feed and the account list show, built like the catalogs'
// MultiSelectFilter (a trigger that names the selection and a checkbox menu
// that stays open while toggling), with each row also saying how many posts
// the region has in the window and how the run reads it. Selecting a region
// the run does not read hourly asks for a read once (the view sends it); the
// row and the feed header follow that read until its posts are in.
import { ChevronDown, LoaderCircle, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type TranslationKey, useTranslation } from "@/lib/i18n";
import { relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import { regionName } from "./ArrivalRegionPanel";
import type { RegionFilterOption } from "./arrival-region-filter";
import { regionReadState } from "./arrival-regions";

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

const HOURLY = "text-emerald-800 dark:text-emerald-200";

/** "3 minutes ago" for a read, or null under a minute, which the copy says as "just now". */
function readAgo(at: string, now: number, language: string): string | null {
  if (now - Date.parse(at) < 60 * 1000) return null;
  return relativeTime(at, now, language === "ja" ? "ja-JP" : "en-US") ?? at;
}
const READING = "text-sky-800 dark:text-sky-200";

/** The trigger's words: All regions, the names of one or two, or how many beyond that. */
export function regionSelectionSummary(
  t: Translate,
  selected: readonly string[],
  options: readonly RegionFilterOption[],
): string {
  if (selected.length === 0) return t("arrivals.allRegions");
  if (selected.length > 2) return t("arrivals.regionFilter.many", { count: selected.length });
  const chosen = new Set(selected);
  return options
    .filter((option) => chosen.has(option.region))
    .map((option) => regionName(t, option.region))
    .join(", ");
}

/** What a region's read is doing right now, for the feed header; null when there is nothing to say. */
export type RegionReadProgress =
  | { kind: "requesting" }
  | { kind: "failed"; message: string }
  | { kind: "reading" }
  | { kind: "queued" }
  | { kind: "read"; at: string };

function RowState({
  option,
  requesting,
  failure,
  now,
}: {
  option: RegionFilterOption;
  requesting: boolean;
  failure: string | null;
  now: number;
}) {
  const { t, language } = useTranslation();
  const line = (className: string, text: string, spinner = false) => (
    <span className={cn("flex min-w-0 items-center gap-1 text-xs font-normal", className)} data-testid="arrival-region-state">
      {spinner && <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />}
      <span className="min-w-0 break-words">{text}</span>
    </span>
  );
  if (requesting) return line(READING, t("arrivals.regionFilter.requesting"), true);
  if (failure !== null) return line("text-destructive", t("arrivals.regionFilter.failed", { message: failure }));
  const status = option.status;
  if (status === null) return null;
  switch (regionReadState(status, now)) {
    case "hourly":
      return line(HOURLY, t("arrivals.regionFilter.hourly"));
    case "reading":
      return line(READING, t("arrivals.regionFilter.reading"), true);
    case "queued":
      return line(READING, t("arrivals.regionFilter.queued"));
    case "nolist":
      return line("text-muted-foreground", t("arrivals.regions.noList"));
    case "idle": {
      const read = status.last_fulfilled?.fulfilled_at ?? null;
      if (read === null) return line("text-muted-foreground", t("arrivals.regionFilter.notRead"));
      const when = readAgo(read, now, language);
      return line(
        "text-muted-foreground",
        when === null ? t("arrivals.regionFilter.readJustNow") : t("arrivals.regionFilter.read", { when }),
      );
    }
  }
}

export default function ArrivalRegionFilter({
  options,
  selected,
  onToggle,
  onClear,
  recentWindow,
  requesting,
  failures,
  now,
}: {
  options: readonly RegionFilterOption[];
  selected: readonly string[];
  onToggle: (region: string) => void;
  onClear: () => void;
  /** The window the counts cover, as its chip reads ("48 h"). */
  recentWindow: string;
  /** Regions whose read-once request is in flight. */
  requesting: ReadonlySet<string>;
  /** The refusal of each region's last read-once request this session. */
  failures: ReadonlyMap<string, string>;
  now: number;
}) {
  const { t } = useTranslation();
  const chosen = new Set(selected);
  const summary = regionSelectionSummary(t, selected, options);
  const knowsStatus = options.some((option) => option.status !== null);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            type="button"
            variant="outline"
            className="h-11 max-w-full sm:h-8"
            aria-label={`${t("arrivals.regionFilterLabel")}: ${summary}`}
            data-testid="arrival-region-filter"
          />
        )}
      >
        <MapPin className="text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 truncate">{summary}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-80 max-w-[calc(100vw-1.5rem)] max-h-[min(40rem,var(--available-height))]"
        data-testid="arrival-region-menu"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="space-y-0.5 px-2 py-1.5">
            <span className="block">{t("arrivals.regionFilter.menuLabel", { window: recentWindow })}</span>
            {knowsStatus && (
              <span className="block font-normal">{t("arrivals.regionFilter.hint")}</span>
            )}
          </DropdownMenuLabel>
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.region}
              checked={chosen.has(option.region)}
              onCheckedChange={() => onToggle(option.region)}
              className="min-h-11 items-start py-1.5 pl-2 sm:min-h-0"
              data-region={option.region}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate">{regionName(t, option.region)}</span>
                  <span
                    className={cn(
                      "shrink-0 text-xs tabular-nums",
                      option.recent_count > 0 ? "text-foreground" : "text-muted-foreground",
                    )}
                    title={t("arrivals.recentCount", { count: option.recent_count, window: recentWindow })}
                  >
                    {option.recent_count}
                  </span>
                </span>
                <RowState
                  option={option}
                  requesting={requesting.has(option.region)}
                  failure={failures.get(option.region) ?? null}
                  now={now}
                />
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        {selected.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-11 pl-2 sm:min-h-0" onClick={onClear}>
              {t("arrivals.regionFilter.clear")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The selected regions' reads, beside the feed header: reading, queued, read, or why a request failed. */
export function ArrivalRegionReads({
  reads,
  now,
}: {
  reads: readonly { region: string; progress: RegionReadProgress }[];
  now: number;
}) {
  const { t, language } = useTranslation();
  if (reads.length === 0) return null;
  return (
    <>
      {reads.map(({ region, progress }) => {
        const name = regionName(t, region);
        if (progress.kind === "failed") {
          return (
            <span key={region} className="break-words text-destructive" role="alert" data-testid="arrival-region-read">
              {t("arrivals.regionProgress.failed", { region: name, message: progress.message })}
            </span>
          );
        }
        const busy = progress.kind === "requesting" || progress.kind === "reading";
        const when = progress.kind === "read" ? readAgo(progress.at, now, language) : null;
        const text = progress.kind !== "read"
          ? t(`arrivals.regionProgress.${progress.kind}`, { region: name })
          : when === null
            ? t("arrivals.regionProgress.readJustNow", { region: name })
            : t("arrivals.regionProgress.read", { region: name, when });
        return (
          <span
            key={region}
            className={cn("flex min-w-0 items-center gap-1.5", busy ? READING : "text-muted-foreground")}
            role="status"
            data-testid="arrival-region-read"
          >
            {busy && <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />}
            <span className="min-w-0 break-words">{text}</span>
          </span>
        );
      })}
    </>
  );
}
