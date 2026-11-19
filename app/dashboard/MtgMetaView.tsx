"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ExternalLink, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/dates";
import { useTranslation } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/select-all";
import { cn } from "@/lib/utils";
import {
  META_ARCHETYPE_COLS,
  META_CARD_COLS,
  META_FORMATS,
  filterMetaCards,
  metaDirection,
  weekChange,
  type MetaArchetypeRow,
  type MetaCardRow,
  type MetaCardSort,
  type MetaDirection,
} from "./mtg-meta";
import type { MtgFormatCode } from "./mtg-tags";
import { QueryError, useSupabaseQuery } from "./use-query";

// The constructed metagame as mtgtop8.com reports it, crawled weekly by
// refresh-mtgtop8-meta (backend #2770, migration 000664): what each format's
// decks are, which cards they play, and which way both are moving.
//
// Every share is mtgtop8's own, over its "Last 2 Months" period, with "Last 2
// Weeks" beside it for direction and the previous weekly crawl for the change
// since last week. The NA median is the same raw near-mint anchor the
// Commander demand view uses, over every printing the catalog prices.
export default function MtgMetaView() {
  const { t, language } = useTranslation();
  const [format, setFormat] = useState<MtgFormatCode>("MO");
  const [board, setBoard] = useState<"MD" | "SB">("MD");
  const [search, setSearch] = useState("");
  const [risingOnly, setRisingOnly] = useState(false);
  const [sort, setSort] = useState<MetaCardSort>("share");
  const [allArchetypes, setAllArchetypes] = useState(false);

  const fetchMeta = useCallback(async () => {
    const supabase = createClient();
    const [archetypes, cards] = await Promise.all([
      selectAll<MetaArchetypeRow>(
        () => supabase.from("mtg_format_archetypes_v").select(META_ARCHETYPE_COLS).eq("format_code", format),
        ["archetype_id"],
      ),
      selectAll<MetaCardRow>(
        () => supabase.from("mtg_format_card_play_v").select(META_CARD_COLS).eq("format_code", format),
        ["board", "card_name"],
      ),
    ]);
    return { archetypes, cards };
  }, [format]);
  const { data, error, isLoading, retry } = useSupabaseQuery(["mtg-meta", format], fetchMeta, { keepPreviousData: false });

  // By share, not by the stored rank: rank is the row's position on the
  // format page, which groups archetypes by macro class, so Modern's largest
  // deck (Broodscale Bloodchief, 16%) sat at position 47 under COMBO.
  const archetypes = useMemo(
    () => [...(data?.archetypes ?? [])].sort((a, b) => b.share_2m - a.share_2m || a.rank - b.rank),
    [data],
  );
  const shownArchetypes = allArchetypes ? archetypes : archetypes.slice(0, ARCHETYPES_SHOWN);
  const cards = useMemo(
    () => filterMetaCards(data?.cards ?? [], { board, search, risingOnly, sort }),
    [data, board, search, risingOnly, sort],
  );
  const first = data?.cards[0] ?? null;
  const isCedh = format === "cEDH";
  const crawled = formatDate(first?.observed_at ?? archetypes[0]?.observed_at, language);

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4" data-testid="mtg-meta-view">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={format} onValueChange={(v) => { setFormat(v as MtgFormatCode); setSearch(""); }}>
          <TabsList>
            {META_FORMATS.map((f) => (
              <TabsTrigger key={f.code} value={f.code} data-testid={`mtg-meta-format-${f.code}`}>
                {t(f.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {crawled && first && (
          <span className="text-xs text-muted-foreground">
            {t("mtgMeta.crawled", { date: crawled, decks: first.total_decks_2m.toLocaleString(language) })}
          </span>
        )}
        {first && (
          <a
            href={first.evidence_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            {t("mtgMeta.source")}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        )}
      </div>

      {error && <QueryError error={error} onRetry={retry} />}
      {!error && isLoading && <p className="text-sm text-muted-foreground">{t("mtgMeta.loading")}</p>}
      {!error && !isLoading && data && data.cards.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="mtg-meta-empty">{t("mtgMeta.empty")}</p>
      )}

      {!error && data && data.cards.length > 0 && (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <section className="min-w-0" aria-labelledby="mtg-meta-archetypes">
            <h2 id="mtg-meta-archetypes" className="mb-2 text-sm font-semibold">
              {isCedh ? t("mtgMeta.commanders") : t("mtgMeta.archetypes")}
            </h2>
            {isCedh ? (
              <p className="text-xs text-muted-foreground">{t("mtgMeta.cedhNoArchetypes")}</p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table data-testid="mtg-meta-archetype-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>{t("mtgMeta.colArchetype")}</TableHead>
                      <TableHead className="text-right"><ResponsiveLabel full={t("mtgMeta.colShare2m")} short={t("mtgMeta.colShare2mShort")} /></TableHead>
                      <TableHead className="text-right"><ResponsiveLabel full={t("mtgMeta.colShare2w")} short={t("mtgMeta.colShare2wShort")} /></TableHead>
                      <TableHead className="hidden text-right sm:table-cell">{t("mtgMeta.colWeek")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shownArchetypes.map((a, index) => (
                      <TableRow key={a.archetype_id}>
                        <TableCell className="tabular-nums text-muted-foreground">{index + 1}</TableCell>
                        <TableCell className="min-w-0 whitespace-normal break-words">
                          <a href={a.evidence_url} target="_blank" rel="noreferrer" className="hover:underline">
                            {a.archetype_name}
                          </a>
                          <span className="block text-[10px] uppercase text-muted-foreground sm:ml-1.5 sm:inline">{a.macro_class}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{pct(a.share_2m)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <ShareWithDirection share={a.share_2w} direction={metaDirection(a.share_2m, a.share_2w)} t={t} />
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums sm:table-cell">
                          <WeekChange value={weekChange(a.share_2m, a.share_2m_prior)} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {archetypes.length > ARCHETYPES_SHOWN && (
                  <Button
                    variant="ghost"
                    className="h-11 w-full rounded-none border-t text-xs sm:h-8"
                    onClick={() => setAllArchetypes((v) => !v)}
                    data-testid="mtg-meta-archetypes-toggle"
                  >
                    {allArchetypes ? t("mtgMeta.showFewer") : t("mtgMeta.showAll", { n: String(archetypes.length) })}
                  </Button>
                )}
              </div>
            )}
          </section>

          <section className="min-w-0" aria-labelledby="mtg-meta-cards">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 id="mtg-meta-cards" className="text-sm font-semibold">{t("mtgMeta.cards")}</h2>
              <Tabs value={board} onValueChange={(v) => setBoard(v as "MD" | "SB")}>
                <TabsList>
                  <TabsTrigger value="MD">{t("mtgMeta.mainDeck")}</TabsTrigger>
                  <TabsTrigger value="SB">{isCedh ? t("mtgMeta.commanders") : t("mtgMeta.sideboard")}</TabsTrigger>
                </TabsList>
              </Tabs>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("mtgMeta.searchPlaceholder")}
                aria-label={t("mtgMeta.searchPlaceholder")}
                className="h-11 w-full sm:h-8 sm:w-48"
              />
              <Button
                variant={risingOnly ? "default" : "outline"}
                className="h-11 sm:h-8"
                onClick={() => setRisingOnly((v) => !v)}
                title={t("mtgMeta.risingOnlyHint")}
              >
                {t("mtgMeta.risingOnly")}
              </Button>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as MetaCardSort)}
                aria-label={t("mtgMeta.sort")}
                className="h-11 rounded-md border bg-transparent px-2 text-sm sm:h-8"
              >
                <option value="share">{t("mtgMeta.sortShare")}</option>
                <option value="recent">{t("mtgMeta.sortRecent")}</option>
                <option value="price">{t("mtgMeta.sortPrice")}</option>
              </select>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <Table data-testid="mtg-meta-card-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("mtgMeta.colCard")}</TableHead>
                    <TableHead className="text-right"><ResponsiveLabel full={t("mtgMeta.colShare2m")} short={t("mtgMeta.colShare2mShort")} /></TableHead>
                    <TableHead className="hidden text-right sm:table-cell">{t("mtgMeta.colAvg")}</TableHead>
                    <TableHead className="text-right"><ResponsiveLabel full={t("mtgMeta.colShare2w")} short={t("mtgMeta.colShare2wShort")} /></TableHead>
                    <TableHead className="hidden text-right sm:table-cell">{t("mtgMeta.colWeek")}</TableHead>
                    <TableHead className="text-right"><ResponsiveLabel full={t("mtgMeta.colPrice")} short={t("mtgMeta.colPriceShort")} /></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cards.map((c) => (
                    <TableRow key={`${c.board}:${c.card_name}`} data-testid="mtg-meta-card-row">
                      <TableCell className="min-w-0 whitespace-normal break-words">
                        <span className={cn(c.in_catalog === false && "text-muted-foreground")}>{c.card_name}</span>
                        {c.in_catalog === false && (
                          <Badge variant="outline" className="ml-1.5 h-auto px-1 py-px text-[10px]" title={t("mtgMeta.notInCatalogHint")}>
                            {t("mtgMeta.notInCatalog")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.share_2m == null ? <span className="text-muted-foreground">-</span> : (
                          <span title={c.decks_2m != null ? t("mtgMeta.decksTitle", { n: c.decks_2m.toLocaleString(language) }) : undefined}>
                            {pct(c.share_2m)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">{(c.avg_2m ?? c.avg_2w)?.toFixed(1) ?? "-"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        <ShareWithDirection share={c.share_2w} direction={metaDirection(c.share_2m, c.share_2w)} t={t} />
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        <WeekChange value={weekChange(c.share_2m, c.share_2m_prior)} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.median_sell_usd == null ? <span className="text-muted-foreground">-</span> : (
                          <span title={t("mtgMeta.priceTitle", { n: String(c.priced_printings ?? 0) })}>
                            ${c.median_sell_usd.toFixed(2)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {cards.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-muted-foreground">{t("mtgMeta.noMatch")}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

// The archetype tail is long - Modern lists 70, most under 1% - so the table
// opens on the top of the metagame and expands on request.
const ARCHETYPES_SHOWN = 15;

// A column header that fits a 390px phone: the full words from the sm
// breakpoint up, an abbreviation below it, and the full words for assistive
// technology at every width.
function ResponsiveLabel({ full, short }: { full: string; short: string }) {
  return (
    <>
      <span className="hidden sm:inline">{full}</span>
      <span className="sm:hidden" aria-hidden="true">{short}</span>
      <span className="sr-only sm:hidden">{full}</span>
    </>
  );
}

function pct(v: number | null | undefined): string {
  return v == null ? "-" : `${v.toFixed(1)}%`;
}

function ShareWithDirection({
  share,
  direction,
  t,
}: {
  share: number | null;
  direction: MetaDirection;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <span className="inline-flex items-center justify-end gap-0.5">
      {pct(share)}
      {direction === "up" && (
        <ArrowUpRight className="size-3 text-emerald-600 dark:text-emerald-400" aria-label={t("mtgMeta.rising")} role="img" />
      )}
      {direction === "down" && (
        <ArrowDownRight className="size-3 text-amber-600 dark:text-amber-400" aria-label={t("mtgMeta.falling")} role="img" />
      )}
      {direction === "new" && (
        <Sparkles className="size-3 text-emerald-600 dark:text-emerald-400" aria-label={t("mtgMeta.new")} role="img" />
      )}
    </span>
  );
}

function WeekChange({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">-</span>;
  if (value === 0) return <span className="text-muted-foreground">0.0</span>;
  return (
    <span className={value > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
      {value > 0 ? "+" : ""}{value.toFixed(1)}
    </span>
  );
}
