"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, EyeOff, Eye, Hash, ImageOff, Layers, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { selectAll, selectAllByIds } from "@/lib/supabase/select-all";
import { useTranslation } from "@/lib/i18n";
import { useHeader } from "./HeaderContext";
import { useBuyList } from "./BuyListContext";
import { type Game, useGame } from "./GameContext";
import {
  type CardRowData,
  type CardDefinition,
  type PriceEntry,
  cardDefCols,
  getCardDisplayName,
} from "./use-card-data";
import { useLanguage } from "./LanguageContext";
import { createBuylistColumns, PriceCell, TargetPriceCell } from "./columns";
import {
  sealedRowToCardRow,
  type SealedRowData,
  type SealedSummaryRow,
} from "./use-sealed-data";
import { DataTable } from "./data-table";
import CardDetailModal from "./CardDetailModal";
import SealedDetailModal from "./SealedDetailModal";
import ExportBuyListModal from "./ExportBuyListModal";
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
  targetPriceUsd: number | null;
  // Sealed-only dimensions (present when game === "pokemon_sealed")
  productType?: string;
  sealedCondition?: string;
  variantEdition?: string;
  language?: string;
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
  const { language } = useLanguage();
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
  const [exportOpen, setExportOpen] = useState(false);

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
          : "mtg_card_definitions_v";

      // A buylist has no fixed size, so page the entries rather than let
      // PostgREST silently cap them at 1000 (a lost entry = a card missing from
      // the list with no error).
      const entries = await selectAll<Record<string, unknown>>(
        () => supabase.from(entryTable).select("entry_id, card_id, psa_grade, target_price_usd").eq("buylist_id", buylistId),
        ["entry_id"],
      );
      if (entries.length === 0) continue;

      const cardIds = entries.map((e) => e.card_id as string);

      // Summaries fan out (~3 tiers/psa rows per card), so this both chunks the
      // card_id list and pages each chunk. Truncation here would drop a tier and
      // silently misprice the entry rather than error. Key: (card_id, tier, psa).
      const summaries = await selectAllByIds<SummaryRow>(
        cardIds,
        ["card_id", "tier", "psa_grade"],
        (chunk) => supabase.from(summaryTable).select(`*, ${cardTable}!inner(${cardDefCols(game)})`).in("card_id", chunk),
      );

      const summaryMap = new Map<string, SummaryRow>();
      for (const s of summaries) {
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
            .select(cardDefCols(game))
            .eq("card_id", cardId)
            .single();

          results.push({
            key: `${game}:${entryId}`,
            card: (directCard as unknown as CardDefinition) ?? {
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
            targetPriceUsd: (entry.target_price_usd as number | null) ?? null,
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
          targetPriceUsd: (entry.target_price_usd as number | null) ?? null,
        });
      }
    }

    // Sealed products: separate entry table keyed on
    // product_id + sealed_condition + variant_edition (not card_id + psa_grade).
    {
      const entries = await selectAll<Record<string, unknown>>(
        () => supabase.from("pokemon_sealed_buylist_entries").select("entry_id, product_id, sealed_condition, variant_edition, target_price_usd").eq("buylist_id", buylistId),
        ["entry_id"],
      );

      if (entries.length > 0) {
        const productIds = entries.map((e) => e.product_id as number);
        // pokemon_sealed_summaries_v exposes product_id as card_id; page on its
        // grain (card_id, sealed_condition, variant_edition).
        const summaries = await selectAllByIds<SealedSummaryRow>(
          productIds,
          ["card_id", "sealed_condition", "variant_edition"],
          (chunk) => supabase.from("pokemon_sealed_summaries_v").select("*").in("card_id", chunk),
        );

        const summaryMap = new Map<string, SealedSummaryRow>();
        for (const s of summaries) {
          summaryMap.set(`${s.card_id}:${s.sealed_condition}:${s.variant_edition}`, s);
        }

        for (const entry of entries as Record<string, unknown>[]) {
          const productId = entry.product_id as number;
          const cond = entry.sealed_condition as string;
          const ed = entry.variant_edition as string;
          const entryId = entry.entry_id as number;
          const summary = summaryMap.get(`${productId}:${cond}:${ed}`);

          let base: SealedRowData;
          if (summary) {
            base = sealedRowToCardRow(summary);
          } else {
            // No current summary for that variant (e.g. no listings); fall back
            // to the product definition with empty prices.
            const { data: directProduct } = await supabase
              .from("pokemon_sealed_products")
              .select(
                "product_id, name, english_name, set_code, misc_info, image_url, product_type, language"
              )
              .eq("product_id", productId)
              .single();
            const p = directProduct as Record<string, unknown> | null;
            base = {
              key: `${productId}:${cond}:${ed}`,
              card: {
                card_id: String(productId),
                regional_name: (p?.name as string) ?? "Unknown",
                english_name: (p?.english_name as string | null) ?? null,
                set_code: (p?.set_code as string) ?? "",
                card_number: null,
                misc_info: (p?.misc_info as string | null) ?? null,
                image_url: (p?.image_url as string | null) ?? null,
              },
              prices: { highestBuy: null, lowestSell: null },
              roi: null,
              productType: (p?.product_type as string) ?? "other",
              sealedCondition: cond,
              variantEdition: ed,
              language: (p?.language as string) ?? "en",
            };
          }

          results.push({
            ...base,
            key: `pokemon_sealed:${entryId}`,
            game: "pokemon_sealed",
            entryId,
            targetPriceUsd: (entry.target_price_usd as number | null) ?? null,
          });
        }
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
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
          <Download className="size-4 mr-1" />
          {t("buyList.export")}
        </Button>
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
      </div>
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

  const columns = useMemo(() => createBuylistColumns(t, language), [t, language]);

  const { setActiveGame } = useGame();

  const handleRowClick = useCallback((row: CardRowData) => {
    const entry = row as BuylistEntryRow;
    setActiveGame(entry.game);
    setSelectedCard(entry);
  }, [setActiveGame]);

  const handleTargetPriceChange = useCallback(
    (eid: number, price: number | null) => {
      setData((prev) =>
        prev.map((row) =>
          row.entryId === eid ? { ...row, targetPriceUsd: price } : row
        )
      );
      setSelectedCard((prev) =>
        prev && prev.entryId === eid ? { ...prev, targetPriceUsd: price } : prev
      );
    },
    []
  );

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
              alt={getCardDisplayName(row.card, language)}
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
              {getCardDisplayName(row.card, language)}
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
              <div className="flex w-full justify-between gap-2 border-t border-foreground/10 pt-2">
                <span className="text-muted-foreground">
                  {t("column.targetPrice")}
                </span>
                <TargetPriceCell value={entry.targetPriceUsd} />
              </div>
            </CardFooter>
          )}
        </Card>
      );
    },
    [t, setActiveGame, compact, language]
  );

  return (
    <div className="space-y-4">
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

      {selectedCard?.game === "pokemon_sealed" ? (
        <SealedDetailModal
          card={{
            ...selectedCard,
            productType: selectedCard.productType ?? "",
            sealedCondition: selectedCard.sealedCondition ?? "",
            variantEdition: selectedCard.variantEdition ?? "",
            language: selectedCard.language ?? "en",
          }}
          open={!!selectedCard}
          onClose={() => setSelectedCard(null)}
          entryId={selectedCard?.entryId}
          targetPriceUsd={selectedCard?.targetPriceUsd}
          onTargetPriceChange={handleTargetPriceChange}
          onRemoveFromBuylist={
            selectedCard
              ? async () => {
                  await removeFromBuylist(selectedCard.game, selectedCard.entryId);
                  fetchEntries();
                }
              : undefined
          }
        />
      ) : (
        <CardDetailModal
          card={selectedCard}
          open={!!selectedCard}
          onClose={() => setSelectedCard(null)}
          entryGame={selectedCard?.game}
          entryId={selectedCard?.entryId}
          targetPriceUsd={selectedCard?.targetPriceUsd}
          onTargetPriceChange={handleTargetPriceChange}
          onRemoveFromBuylist={
            selectedCard
              ? async () => {
                  await removeFromBuylist(selectedCard.game, selectedCard.entryId);
                  fetchEntries();
                }
              : undefined
          }
        />
      )}

      <ExportBuyListModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        cards={data}
        buylistName={buylist?.name ?? "buylist"}
      />
    </div>
  );
}
