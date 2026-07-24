"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ImageOff, Layers, Package, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTranslation } from "@/lib/i18n";
import { useHeader } from "./HeaderContext";
import { useLanguage } from "./LanguageContext";
import { type CardRowData, type RegionFilter, getCardDisplayName } from "./use-card-data";
import {
  useSealedData,
  conditionLabel,
  editionLabel,
  productTypeLabel,
  SEALED_CONDITIONS,
  SEALED_EDITIONS,
  type SealedCondition,
  type SealedEdition,
  type SealedRowData,
} from "./use-sealed-data";
import { createSealedColumns, PriceCell } from "./columns";
import { DataTable } from "./data-table";
import SealedDetailModal from "./SealedDetailModal";
import {
  ownedInventoryKey,
  useOwnedInventoryCounts,
  type OwnedInventoryIdentity,
} from "./owned-inventory";
import { OwnedCountLine } from "./OwnedCountLine";

export default function SealedBrowser() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { setHeaderActions } = useHeader();
  const [search, setSearch] = useState("");
  const [searchSetCode, setSearchSetCode] = useState("");
  const [condition, setCondition] = useState<SealedCondition>("best");
  const [edition, setEdition] = useState<SealedEdition>("best");
  const [sellRegion, setSellRegion] = useState<RegionFilter>("all");
  const [minBuyPrice, setMinBuyPrice] = useState<string>("");
  const [minSellPrice, setMinSellPrice] = useState<string>("");
  const [roiFloor, setRoiFloor] = useState<string>("");
  const [roiCeiling, setRoiCeiling] = useState<string>("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [sortColumn, setSortColumn] = useState("roi");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [selectedCard, setSelectedCard] = useState<SealedRowData | null>(null);
  const [refreshOpen, setRefreshOpen] = useState(false);

  const { data, loading, error, totalCount, refresh } = useSealedData({
    search,
    searchSetCode,
    condition,
    edition,
    sellRegion,
    minBuyPrice: minBuyPrice !== "" ? Number(minBuyPrice) : null,
    minSellPrice: minSellPrice !== "" ? Number(minSellPrice) : null,
    roiFloor: roiFloor !== "" ? Number(roiFloor) : null,
    roiCeiling: roiCeiling !== "" ? Number(roiCeiling) : null,
    sortColumn,
    sortAsc,
    page,
    pageSize,
  });
  const ownedIdentities = useMemo<OwnedInventoryIdentity[]>(
    () => data.map((row) => ({
      game: "pokemon_sealed",
      productId: row.card.card_id,
      sealedCondition: row.sealedCondition,
      variantEdition: row.variantEdition,
    })),
    [data],
  );
  const ownedCounts = useOwnedInventoryCounts(
    "pokemon_sealed",
    ownedIdentities,
  );
  const dataWithOwned = useMemo(
    () => data.map((row) => {
      const counts = ownedCounts.get(ownedInventoryKey({
        game: "pokemon_sealed",
        productId: row.card.card_id,
        sealedCondition: row.sealedCondition,
        variantEdition: row.variantEdition,
      }));
      return { ...row, ownedQty: counts?.owned ?? 0, incomingQty: counts?.incoming ?? 0 };
    }),
    [data, ownedCounts],
  );

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [search, searchSetCode, condition, edition, sellRegion, minBuyPrice, minSellPrice, roiFloor, roiCeiling, sortColumn, sortAsc, pageSize]);

  useEffect(() => {
    setHeaderActions(null);
    return () => setHeaderActions(null);
  }, [setHeaderActions]);

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

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const conditionTriggerLabel =
    condition === "best"
      ? t("sealedBrowser.conditionBest")
      : conditionLabel(t, condition);
  const editionTriggerLabel =
    edition === "best" ? t("sealedBrowser.editionBest") : editionLabel(t, edition);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Input
          type="text"
          placeholder={t("cardBrowser.namePlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="col-span-2"
        />
        <Input
          type="text"
          placeholder={t("cardBrowser.setCodePlaceholder")}
          value={searchSetCode}
          onChange={(e) => setSearchSetCode(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" className="shrink-0" />}>
            {t("sealedBrowser.conditionPrefix")}{conditionTriggerLabel}
            <ChevronDown className="ml-1 size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup
              value={condition}
              onValueChange={(v) => setCondition(v as SealedCondition)}
            >
              {SEALED_CONDITIONS.map((c) => (
                <DropdownMenuRadioItem key={c} value={c}>
                  {c === "best" ? t("sealedBrowser.conditionBest") : conditionLabel(t, c)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" className="shrink-0" />}>
            {t("sealedBrowser.editionPrefix")}{editionTriggerLabel}
            <ChevronDown className="ml-1 size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup
              value={edition}
              onValueChange={(v) => setEdition(v as SealedEdition)}
            >
              {SEALED_EDITIONS.map((e) => (
                <DropdownMenuRadioItem key={e} value={e}>
                  {e === "best" ? t("sealedBrowser.editionBest") : editionLabel(t, e)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" className="shrink-0" />}>
            {sellRegion === "all" ? t("cardBrowser.regionAll") : sellRegion}
            <ChevronDown className="ml-1 size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup
              value={sellRegion}
              onValueChange={(v) => setSellRegion(v as RegionFilter)}
            >
              <DropdownMenuRadioItem value="all">{t("cardBrowser.regionAll")}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="NA">{t("cardBrowser.regionNA")}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="JP">{t("cardBrowser.regionJP")}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Input
          type="number"
          placeholder={t("cardBrowser.minBuyPrice")}
          value={minBuyPrice}
          onChange={(e) => setMinBuyPrice(e.target.value)}
          className="min-w-0 flex-1"
        />
        <Input
          type="number"
          placeholder={t("cardBrowser.minSellPrice")}
          value={minSellPrice}
          onChange={(e) => setMinSellPrice(e.target.value)}
          className="min-w-0 flex-1"
        />
        <Input
          type="number"
          placeholder={t("cardBrowser.roiFloor")}
          value={roiFloor}
          onChange={(e) => setRoiFloor(e.target.value)}
          className="min-w-0 flex-1"
        />
        <Input
          type="number"
          placeholder={t("cardBrowser.roiCeiling")}
          value={roiCeiling}
          onChange={(e) => setRoiCeiling(e.target.value)}
          className="min-w-0 flex-1"
        />
      </div>
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
        <AlertDialog open={refreshOpen} onOpenChange={setRefreshOpen}>
          <AlertDialogTrigger
            render={
              <Button variant="outline" size="icon" disabled={loading} className="shrink-0" />
            }
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("refresh.title")}</AlertDialogTitle>
              <AlertDialogDescription>{t("refresh.description")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("refresh.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setRefreshOpen(false); refresh(); }}>{t("refresh.confirm")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {error && (
        <p className="text-destructive text-sm">{t("cardBrowser.error", { message: error })}</p>
      )}

      <DataTable
        columns={useMemo(() => createSealedColumns(t, language), [t, language])}
        data={dataWithOwned as CardRowData[]}
        loading={loading}
        sorting={sorting}
        onSortingChange={handleSortingChange}
        onRowClick={(row) => setSelectedCard(row as SealedRowData)}
        viewMode={viewMode}
        serverPagination={{
          page,
          pageSize,
          totalCount,
          totalPages,
          onPageChange: setPage,
          onPageSizeChange: setPageSize,
        }}
        renderGridItem={useCallback(
          (cardRow: CardRowData) => {
            const row = cardRow as SealedRowData;
            const misc =
              row.card.misc_info && row.card.misc_info !== "UNKNOWN"
                ? row.card.misc_info
                : null;
            const setCode =
              row.card.set_code && row.card.set_code !== "UNKNOWN"
                ? row.card.set_code
                : null;
            const buyEntry = row.prices.highestBuy;
            const sellEntry = row.prices.lowestSell;

            return (
              <Card
                size="sm"
                className="h-full cursor-pointer gap-0 !py-0 transition-colors hover:bg-accent/50"
                onClick={() => setSelectedCard(row)}
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
                      <Badge variant="secondary" className="h-auto px-1.5 py-px">
                        <Package className="size-3" />
                        {productTypeLabel(t, row.productType)}
                      </Badge>
                      {setCode && (
                        <Badge variant="secondary" className="h-auto px-1.5 py-px">
                          <Layers className="size-3" />
                          {setCode}
                        </Badge>
                      )}
                    </div>
                  </CardAction>
                  <CardTitle className="truncate text-lg">{getCardDisplayName(row.card, language)}</CardTitle>
                  <CardDescription className="truncate text-xs">
                    {editionLabel(t, row.variantEdition)} · {conditionLabel(t, row.sealedCondition)}
                    {misc ? ` · ${misc}` : ""}
                  </CardDescription>
                  <OwnedCountLine owned={row.ownedQty} incoming={row.incomingQty} />
                </CardHeader>
                <CardFooter className="mt-auto flex-col gap-2 text-xs">
                  <div className="grid w-full grid-cols-[1fr_auto_1fr] gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="text-muted-foreground">{t("column.lowestSell")}</div>
                      <PriceCell entry={sellEntry} badgeVariant="outline" />
                    </div>
                    <div className="w-px self-stretch bg-foreground/10" />
                    <div className="min-w-0 space-y-1 text-right">
                      <div className="text-muted-foreground">{t("column.highestBuy")}</div>
                      <PriceCell entry={buyEntry} align="right" badgeVariant="outline" />
                    </div>
                  </div>
                  <div className="flex w-full justify-between gap-2 border-t border-foreground/10 pt-2">
                    <span className="text-muted-foreground">{t("column.roi")}</span>
                    <span>{row.roi !== null ? `${Math.round(row.roi * 100) / 100}%` : "—"}</span>
                  </div>
                </CardFooter>
              </Card>
            );
          },
          [t, language]
        )}
      />

      <SealedDetailModal
        card={selectedCard}
        open={!!selectedCard}
        onClose={() => setSelectedCard(null)}
      />
    </div>
  );
}
