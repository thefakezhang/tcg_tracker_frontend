"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EyeOff, Eye, Hash, ImageOff, Layers, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useHeader } from "./HeaderContext";
import { useBuyList } from "./BuyListContext";
import { type Game, useGame } from "./GameContext";
import {
  type CardRowData,
  type CardDefinition,
  type PriceEntry,
} from "./use-card-data";
import { createColumns, PriceCell } from "./columns";
import { DataTable } from "./data-table";
import CardDetailModal from "./CardDetailModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface BuyListViewProps {
  buylistId: number;
}

interface BuylistEntryRow extends CardRowData {
  game: Game;
  entryId: number;
}

interface SummaryRow {
  card_id: number;
  tier: number;
  psa_grade: number;
  best_buy_price: number | null;
  best_buy_currency: string | null;
  best_buy_symbol: string | null;
  best_buy_location: string | null;
  best_buy_region: string | null;
  best_buy_normalized: number | null;
  best_sell_price: number | null;
  best_sell_currency: string | null;
  best_sell_symbol: string | null;
  best_sell_location: string | null;
  best_sell_region: string | null;
  best_sell_normalized: number | null;
  roi: number | null;
  [key: string]: unknown;
}

function summaryToPrice(
  row: SummaryRow,
  side: "buy" | "sell"
): PriceEntry | null {
  const price = side === "buy" ? row.best_buy_price : row.best_sell_price;
  if (price == null) return null;
  return {
    price,
    symbol: (side === "buy" ? row.best_buy_symbol : row.best_sell_symbol) ?? "",
    currencyCode:
      (side === "buy" ? row.best_buy_currency : row.best_sell_currency) ?? "",
    normalizedPrice:
      (side === "buy" ? row.best_buy_normalized : row.best_sell_normalized) ?? 0,
    locationName:
      (side === "buy" ? row.best_buy_location : row.best_sell_location) ?? "",
    marketRegion:
      (side === "buy" ? row.best_buy_region : row.best_sell_region) ?? null,
  };
}

export default function BuyListView({ buylistId }: BuyListViewProps) {
  const { t } = useTranslation();
  const { setHeaderActions } = useHeader();
  const { buylists, deleteBuylist, removeFromBuylist, setActiveBuylistId } =
    useBuyList();
  const [data, setData] = useState<BuylistEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [selectedCard, setSelectedCard] = useState<BuylistEntryRow | null>(
    null
  );
  const [sortColumn, setSortColumn] = useState("roi");
  const [sortAsc, setSortAsc] = useState(false);
  const [compact, setCompact] = useState(true);

  const buylist = buylists.find((b) => b.buylist_id === buylistId);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    const results: BuylistEntryRow[] = [];

    for (const game of ["pokemon", "mtg"] as Game[]) {
      const entryTable =
        game === "pokemon" ? "pokemon_buylist_entries" : "mtg_buylist_entries";
      const summaryTable =
        game === "pokemon"
          ? "pokemon_price_summaries"
          : "mtg_price_summaries";
      const cardTable =
        game === "pokemon"
          ? "pokemon_card_definitions"
          : "mtg_card_definitions";

      const { data: entries } = await supabase
        .from(entryTable)
        .select("entry_id, card_id, psa_grade")
        .eq("buylist_id", buylistId);

      if (!entries || entries.length === 0) continue;

      const cardIds = entries.map((e: Record<string, unknown>) => e.card_id as string);

      // Fetch summaries with joined card defs
      // For each entry, match on card_id + tier/psa_grade
      const { data: summaries } = await supabase
        .from(summaryTable)
        .select(
          `*, ${cardTable}!inner(card_id, regional_name, set_code, card_number, misc_info, image_url)`
        )
        .in("card_id", cardIds);

      const summaryMap = new Map<string, SummaryRow>();
      for (const s of (summaries ?? []) as unknown as SummaryRow[]) {
        // Key by card_id:psa_grade:tier
        const key = `${s.card_id}:${s.psa_grade}:${s.tier}`;
        summaryMap.set(key, s);
      }

      for (const entry of entries as Record<string, unknown>[]) {
        const cardId = entry.card_id as string;
        const psaGrade = (entry.psa_grade as number) ?? 0;
        const entryId = entry.entry_id as number;

        // Find best matching summary row
        let summary: SummaryRow | undefined;
        if (psaGrade > 0) {
          summary = summaryMap.get(`${cardId}:${psaGrade}:-1`);
        } else {
          // Try tier 1, then any available
          summary = summaryMap.get(`${cardId}:0:1`);
          if (!summary) {
            for (const [key, s] of summaryMap) {
              if (key.startsWith(`${cardId}:0:`)) {
                summary = s;
                break;
              }
            }
          }
        }

        const cardDef = summary
          ? (summary[cardTable] as CardDefinition)
          : null;

        if (!cardDef) {
          // Card definition not found via summary, fetch directly
          const { data: directCard } = await supabase
            .from(cardTable)
            .select("card_id, regional_name, set_code, card_number, misc_info, image_url")
            .eq("card_id", cardId)
            .single();

          results.push({
            key: `${game}:${entryId}`,
            card: (directCard as CardDefinition) ?? {
              card_id: cardId,
              regional_name: "Unknown",
              set_code: "",
              card_number: null,
              misc_info: null,
              image_url: null,
            },
            psaGrade: psaGrade > 0 ? psaGrade : undefined,
            prices: { highestBuy: null, lowestSell: null },
            roi: null,
            game,
            entryId,
          });
          continue;
        }

        results.push({
          key: `${game}:${entryId}`,
          card: cardDef,
          psaGrade: psaGrade > 0 ? psaGrade : undefined,
          prices: {
            highestBuy: summary ? summaryToPrice(summary, "buy") : null,
            lowestSell: summary ? summaryToPrice(summary, "sell") : null,
          },
          roi: summary?.roi ?? null,
          game,
          entryId,
        });
      }
    }

    setData(results);
    setLoading(false);
  }, [buylistId]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  useEffect(() => {
    setHeaderActions(
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button variant="outline" size="sm" />
          }
        >
          <Trash2 className="size-4 mr-1" />
          {t("buyList.delete")}
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("buyList.deleteConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>{buylist?.name}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("buyList.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await deleteBuylist(buylistId);
                setActiveBuylistId(null);
              }}
            >
              {t("buyList.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
    return () => setHeaderActions(null);
  }, [setHeaderActions, buylistId, buylist?.name, deleteBuylist, setActiveBuylistId, t]);

  const handleSortingChange = useCallback(
    (sorting: { id: string; desc: boolean }[]) => {
      if (sorting.length > 0) {
        setSortColumn(sorting[0].id);
        setSortAsc(!sorting[0].desc);
      }
    },
    []
  );

  const sorting = useMemo(
    () => [{ id: sortColumn, desc: !sortAsc }],
    [sortColumn, sortAsc]
  );

  const columns = useMemo(() => createColumns(t), [t]);

  const { setActiveGame } = useGame();

  const handleRowClick = useCallback((row: CardRowData) => {
    const entry = row as BuylistEntryRow;
    setActiveGame(entry.game);
    setSelectedCard(entry);
  }, [setActiveGame]);

  const renderGridItem = useCallback(
    (row: CardRowData) => {
      const entry = row as BuylistEntryRow;
      const misc =
        row.card.misc_info && row.card.misc_info !== "UNKNOWN"
          ? row.card.misc_info
          : null;
      const cardNumber =
        row.card.card_number && row.card.card_number !== "UNKNOWN"
          ? row.card.card_number
          : null;
      const buyPrice = row.prices.highestBuy;
      const sellPrice = row.prices.lowestSell;

      return (
        <Card
          size="sm"
          className="h-full cursor-pointer gap-0 !py-0 transition-colors hover:bg-accent/50"
          onClick={() => {
            setActiveGame(entry.game);
            setSelectedCard(entry);
          }}
        >
          {row.card.image_url ? (
            <img
              src={row.card.image_url}
              alt={row.card.regional_name}
              className="aspect-[5/7] w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex aspect-[5/7] w-full items-center justify-center bg-muted">
              <ImageOff className="size-8 text-muted-foreground" />
            </div>
          )}
          <CardHeader className="pt-1">
            <CardAction>
              <div className="flex flex-col items-end gap-1">
                {cardNumber && (
                  <Badge variant="secondary" className="h-auto px-1.5 py-px">
                    <Hash className="size-3" />
                    {cardNumber}
                  </Badge>
                )}
                <Badge variant="secondary" className="h-auto px-1.5 py-px">
                  <Layers className="size-3" />
                  {row.card.set_code}
                </Badge>
              </div>
            </CardAction>
            <CardTitle className="truncate text-lg">
              {row.card.regional_name}
            </CardTitle>
            {misc && (
              <CardDescription className="truncate text-xs">
                {misc}
              </CardDescription>
            )}
          </CardHeader>
          {compact && <div className="pb-1" />}
          {!compact && (
            <CardFooter className="mt-auto flex-col gap-2 text-xs">
              <div className="grid w-full grid-cols-[1fr_auto_1fr] gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="text-muted-foreground">
                    {t("column.lowestSell")}
                  </div>
                  <PriceCell entry={sellPrice} badgeVariant="outline" />
                </div>
                <div className="w-px self-stretch bg-foreground/10" />
                <div className="min-w-0 space-y-1 text-right">
                  <div className="text-muted-foreground">
                    {t("column.highestBuy")}
                  </div>
                  <PriceCell
                    entry={buyPrice}
                    align="right"
                    badgeVariant="outline"
                  />
                </div>
              </div>
              <div className="flex w-full justify-between gap-2 border-t border-foreground/10 pt-2">
                <span className="text-muted-foreground">
                  {t("column.roi")}
                </span>
                <span>
                  {row.roi !== null
                    ? `${Math.round(row.roi * 100) / 100}%`
                    : "\u2014"}
                </span>
              </div>
            </CardFooter>
          )}
        </Card>
      );
    },
    [t, setActiveGame, compact]
  );

  return (
    <div className="space-y-4">
      {buylist?.description && (
        <p className="text-sm text-muted-foreground">{buylist.description}</p>
      )}
      <div className="flex items-center gap-2">
        <Tabs
          value={viewMode}
          onValueChange={(v) => setViewMode(String(v) as "list" | "grid")}
          className="shrink-0"
        >
          <TabsList>
            <TabsTrigger value="list">{t("cardBrowser.list")}</TabsTrigger>
            <TabsTrigger value="grid">{t("cardBrowser.grid")}</TabsTrigger>
          </TabsList>
        </Tabs>
        {viewMode === "grid" && (
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCompact((c) => !c)}
          >
            {compact ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          </Button>
        )}
      </div>

      {!loading && data.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-muted-foreground">
          {t("buyList.empty")}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={data}
          loading={loading}
          sorting={sorting}
          onSortingChange={handleSortingChange}
          onRowClick={handleRowClick}
          viewMode={viewMode}
          renderGridItem={renderGridItem}
        />
      )}

      <CardDetailModal
        card={selectedCard}
        open={!!selectedCard}
        onClose={() => setSelectedCard(null)}
      />
    </div>
  );
}
