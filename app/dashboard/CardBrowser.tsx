"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Hash, Layers, RefreshCw } from "lucide-react";
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
import { useGame } from "./GameContext";
import { useHeader } from "./HeaderContext";
import { useCardData, type CardRowData, type RegionFilter } from "./use-card-data";
import { createColumns, PriceCell } from "./columns";
import { DataTable } from "./data-table";
import CardDetailModal from "./CardDetailModal";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ImageOff } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

export default function CardBrowser() {
  const { t } = useTranslation();
  const { activeGame, psaMode, setPsaMode } = useGame();
  const { setHeaderActions } = useHeader();
  const [search, setSearch] = useState("");
  const [searchCardNumber, setSearchCardNumber] = useState("");
  const [searchSetCode, setSearchSetCode] = useState("");
  const [selectedTier, setSelectedTier] = useState(1);
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
  const [selectedCard, setSelectedCard] = useState<CardRowData | null>(null);

  const [refreshOpen, setRefreshOpen] = useState(false);

  const { data, loading, error, availableTiers, totalCount, refetch, refresh } =
    useCardData({
      activeGame,
      psaMode,
      search,
      searchCardNumber,
      searchSetCode,
      selectedTier,
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

  // Reset filters on game change
  useEffect(() => {
    setSearch("");
    setSearchCardNumber("");
    setSearchSetCode("");
    setSelectedTier(1);
    setSellRegion("all");
    setMinBuyPrice("");
    setMinSellPrice("");
    setRoiFloor("");
    setRoiCeiling("");
    setPage(0);
  }, [activeGame]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [search, searchCardNumber, searchSetCode, selectedTier, sellRegion, minBuyPrice, minSellPrice, roiFloor, roiCeiling, psaMode, sortColumn, sortAsc, pageSize]);

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

  const columnVisibility = {
    psa_grade: psaMode === "psa",
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Input
          type="text"
          placeholder={t("cardBrowser.namePlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="col-span-2"
        />
        <Input
          type="text"
          placeholder={t("cardBrowser.cardNumberPlaceholder")}
          value={searchCardNumber}
          onChange={(e) => setSearchCardNumber(e.target.value)}
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
          <DropdownMenuTrigger
            render={
              <Button variant="outline" className="shrink-0" />
            }
          >
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
              <Button
                variant="outline"
                size="icon"
                disabled={loading}
                className="shrink-0"
              />
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
        <div className="ml-auto flex items-center gap-2">
          {psaMode === "non-psa" && availableTiers.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" className="shrink-0" />
                }
              >
                {t("cardBrowser.tierPrefix")}{selectedTier}
                <ChevronDown className="ml-1 size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuRadioGroup
                  value={String(selectedTier)}
                  onValueChange={(v) => setSelectedTier(Number(v))}
                >
                  {availableTiers.map((tier) => (
                    <DropdownMenuRadioItem key={tier} value={String(tier)}>
                      {t("cardBrowser.tierItem", { tier })}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Tabs
            value={psaMode === "psa" ? "psa" : "non-psa"}
            onValueChange={(v) => setPsaMode(String(v) === "psa" ? "psa" : "non-psa")}
            className="shrink-0"
          >
            <TabsList>
              <TabsTrigger value="non-psa">{t("modal.tabNonPsa")}</TabsTrigger>
              <TabsTrigger value="psa">{t("modal.tabPsa")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {error && (
        <p className="text-destructive text-sm">{t("cardBrowser.error", { message: error })}</p>
      )}

      <DataTable
        columns={useMemo(() => createColumns(t), [t])}
        data={data}
        loading={loading}
        sorting={sorting}
        onSortingChange={handleSortingChange}
        columnVisibility={columnVisibility}
        onRowClick={setSelectedCard}
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
          (row: CardRowData) => {
            const misc =
              row.card.misc_info && row.card.misc_info !== "UNKNOWN"
                ? row.card.misc_info
                : null;
            const cardNumber =
              row.card.card_number && row.card.card_number !== "UNKNOWN"
                ? row.card.card_number
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
                  <CardTitle className="truncate text-lg">{row.card.regional_name}</CardTitle>
                  {misc && (
                    <CardDescription className="truncate text-xs">
                      {misc}
                    </CardDescription>
                  )}
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
                    <span>{row.roi !== null ? `${Math.round(row.roi * 100) / 100}%` : "\u2014"}</span>
                  </div>
                </CardFooter>
              </Card>
            );
          },
          [t]
        )}
      />

      <CardDetailModal
        card={selectedCard}
        open={!!selectedCard}
        onClose={() => setSelectedCard(null)}
        initialPsaMode={psaMode}
        initialTier={selectedTier}
      />
    </div>
  );
}
