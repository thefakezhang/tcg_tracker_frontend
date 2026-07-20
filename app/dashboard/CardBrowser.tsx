"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RowSelectionState } from "@tanstack/react-table";
import { ChevronDown, CircleAlert, Hash, Layers, RefreshCw } from "lucide-react";
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
import { useCardData, type CardRowData, type RegionFilter, getCardDisplayName } from "./use-card-data";
import { RefreshPricesAction } from "./RefreshPricesAction";
import { RefreshInFlightStrip } from "./RefreshInFlightStrip";
import { useLanguage } from "./LanguageContext";
import { createColumns, createMtgColumns, PriceCell, selectColumn } from "./columns";
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
import { useExitBasis, type ExitPercentile } from "./ExitBasisContext";
import { exitValue, isHighValueWeakEvidence } from "./grade-signals";
import DecisionWatchlist from "./DecisionWatchlist";

// TCGPlayer's Pokémon rarity taxonomy (the values stored in
// pokemon_card_definitions.rarity), ordered low → high for the filter dropdown.
const POKEMON_RARITIES = [
  "Common", "Uncommon", "Rare", "Holo Rare", "Rare Holo LV.X", "Rare Holo LEGEND",
  "Double Rare", "Super Rare", "Super Rare Holo", "Ultra Rare", "Shiny Rare",
  "Shiny Secret Rare", "Art Rare", "Special Art Rare", "Hyper Rare", "Triple Rare",
  "Character Rare", "Character Super Rare", "Trainer Rare", "Prism Rare",
  "ACE Rare", "Amazing Rare", "Radiant Rare",
  // "Promo" rarity is intentionally omitted — the "Promos" dropdown entry
  // (PROMOS_OPTION) is the complete promo filter and already includes rarity=Promo.
];

// Sentinel for the "Promos" entry in the rarity dropdown — selects the
// cross-cutting promo filter (set_code/rarity) rather than a single rarity value.
const PROMOS_OPTION = "__promos__";

export default function CardBrowser() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { activeGame, psaMode, setPsaMode } = useGame();
  const { exitPercentile, setExitPercentile } = useExitBasis();
  const { setHeaderActions } = useHeader();
  const [search, setSearch] = useState("");
  const [searchCardNumber, setSearchCardNumber] = useState("");
  const [searchSetCode, setSearchSetCode] = useState("");
  const [selectedTier, setSelectedTier] = useState(1);
  const [sellRegion, setSellRegion] = useState<RegionFilter>("all");
  const [rarity, setRarity] = useState<string>("");          // "" = all (Pokémon only)
  const [promosOnly, setPromosOnly] = useState(false);       // Pokémon promotional cards
  const [jpExclusiveOnly, setJpExclusiveOnly] = useState(false); // manual JP-exclusive flag
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
  const [weakEvidenceOnly, setWeakEvidenceOnly] = useState(false);
  const [surface, setSurface] = useState<"browse" | "watchlist">("browse");

  const [refreshOpen, setRefreshOpen] = useState(false);
  // Multi-select for targeted price refresh (redesign R6). Pokemon singles only -
  // request_card_refresh resolves pokemon cards.
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const selectionEnabled = activeGame === "pokemon";

  const { data, loading, error, availableTiers, totalCount, refetch, refresh } =
    useCardData({
      activeGame,
      psaMode,
      search,
      searchCardNumber,
      searchSetCode,
      selectedTier,
      sellRegion,
      rarity: rarity || null,
      promosOnly,
      jpExclusiveOnly,
      minBuyPrice: minBuyPrice !== "" ? Number(minBuyPrice) : null,
      minSellPrice: minSellPrice !== "" ? Number(minSellPrice) : null,
      roiFloor: roiFloor !== "" ? Number(roiFloor) : null,
      roiCeiling: roiCeiling !== "" ? Number(roiCeiling) : null,
      sortColumn,
      sortAsc,
      exitPercentile,
      page,
      pageSize,
    });

  const visibleData = useMemo(
    () => weakEvidenceOnly ? data.filter((row) => isHighValueWeakEvidence(row.signal)) : data,
    [data, weakEvidenceOnly],
  );

  // A card can occupy two rows (PSA and non-PSA share a card_id), so dedupe -
  // the RPC should be asked once per card.
  const selectedCardIds = useMemo(() => {
    if (!selectionEnabled) return [];
    const ids = new Set<number>();
    for (const row of data) {
      if (rowSelection[row.key]) ids.add(Number(row.card.card_id));
    }
    return [...ids];
  }, [data, rowSelection, selectionEnabled]);

  // Reset filters on game change
  useEffect(() => {
    setSearch("");
    setSearchCardNumber("");
    setSearchSetCode("");
    setSelectedTier(1);
    setSellRegion("all");
    setRarity("");
    setPromosOnly(false);
    setJpExclusiveOnly(false);
    setWeakEvidenceOnly(false);
    setMinBuyPrice("");
    setMinSellPrice("");
    setRoiFloor("");
    setRoiCeiling("");
    setPage(0);
    // MTG isn't PSA-graded — keep it in non-PSA (condition) mode.
    if (activeGame === "mtg") setPsaMode("non-psa");
  }, [activeGame, setPsaMode]);

  // Selection is page-local (row ids come from the current page), so a selection
  // made under different filters or on another page is meaningless - clear it.
  useEffect(() => {
    setRowSelection({});
  }, [page]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
    setRowSelection({});
  }, [search, searchCardNumber, searchSetCode, selectedTier, sellRegion, rarity, promosOnly, jpExclusiveOnly, minBuyPrice, minSellPrice, roiFloor, roiCeiling, psaMode, sortColumn, sortAsc, pageSize]);

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

  const surfaceTabs = (
    <Tabs value={surface} onValueChange={(value) => setSurface(String(value) as "browse" | "watchlist")}>
      <TabsList>
        <TabsTrigger value="browse">{t("decision.browse")}</TabsTrigger>
        <TabsTrigger value="watchlist">{t("decision.watchlist")}</TabsTrigger>
      </TabsList>
    </Tabs>
  );

  if (activeGame === "pokemon" && surface === "watchlist") {
    return <div className="space-y-4">{surfaceTabs}<DecisionWatchlist /></div>;
  }

  return (
    <div className="space-y-4">
      {activeGame === "pokemon" && surfaceTabs}
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
        {activeGame === "pokemon" && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" className="shrink-0" />}>
              {promosOnly ? t("cardBrowser.promosOnly") : rarity || t("cardBrowser.rarityAll")}
              <ChevronDown className="ml-1 size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-72 overflow-auto">
              <DropdownMenuRadioGroup
                value={promosOnly ? PROMOS_OPTION : rarity}
                onValueChange={(v) => {
                  if (v === PROMOS_OPTION) { setPromosOnly(true); setRarity(""); }
                  else { setPromosOnly(false); setRarity(v); }
                }}
              >
                <DropdownMenuRadioItem value="">{t("cardBrowser.rarityAll")}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value={PROMOS_OPTION}>{t("cardBrowser.promosOnly")}</DropdownMenuRadioItem>
                {POKEMON_RARITIES.map((r) => (
                  <DropdownMenuRadioItem key={r} value={r}>{r}</DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {activeGame === "pokemon" && (
          <Button
            variant={jpExclusiveOnly ? "default" : "outline"}
            className="shrink-0"
            onClick={() => setJpExclusiveOnly((v) => !v)}
          >
            {t("cardBrowser.jpExclusiveOnly")}
          </Button>
        )}
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
          {activeGame === "pokemon" && (
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              {t("evidence.exitBasis")}
              <select
                className="h-8 rounded-md border bg-background px-2 text-foreground"
                value={exitPercentile}
                onChange={(event) => setExitPercentile(Number(event.target.value) as ExitPercentile)}
              >
                <option value={10}>P10</option>
                <option value={25}>P25</option>
                <option value={50}>P50</option>
              </select>
            </label>
          )}
          {activeGame === "pokemon" && (
            <Button
              variant={weakEvidenceOnly ? "default" : "outline"}
              size="sm"
              className="shrink-0"
              onClick={() => setWeakEvidenceOnly((value) => !value)}
              title={t("evidence.weakFilterHelp")}
            >
              <CircleAlert className="size-4" />
              {t("evidence.weakFilter")}
            </Button>
          )}
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
          {activeGame !== "mtg" && (
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
          )}
        </div>
      </div>

      {error && (
        <p className="text-destructive text-sm">{t("cardBrowser.error", { message: error })}</p>
      )}

      {/* Multi-select refresh (redesign R6). The action hides itself when none of
          the selected cards has a refreshable source, so this strip only appears
          when there is something to actually do. */}
      {selectionEnabled && <RefreshInFlightStrip />}

      {selectionEnabled && selectedCardIds.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-xs">
            {t("cardBrowser.selectedCount", { count: selectedCardIds.length })}
          </span>
          <RefreshPricesAction cardIds={selectedCardIds} />
        </div>
      )}

      <DataTable
        columns={useMemo(
          () =>
            activeGame === "mtg"
              ? createMtgColumns(t, language)
              : [selectColumn, ...createColumns(t, language)],
          [t, language, activeGame],
        )}
        data={visibleData}
        loading={loading}
        sorting={sorting}
        onSortingChange={handleSortingChange}
        columnVisibility={columnVisibility}
        onRowClick={setSelectedCard}
        viewMode={viewMode}
        getRowId={(row) => row.key}
        rowSelection={selectionEnabled ? rowSelection : undefined}
        onRowSelectionChange={selectionEnabled ? setRowSelection : undefined}
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
            const conservativeExit = exitValue(row.signal, exitPercentile);

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
                  <CardTitle className="truncate text-lg">{getCardDisplayName(row.card, language)}</CardTitle>
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
                  {activeGame === "pokemon" && (
                    <div className="flex w-full justify-between gap-2 border-t border-foreground/10 pt-2">
                      <span className="text-muted-foreground">P{exitPercentile} {t("column.conservativeExit")}</span>
                      <span>{conservativeExit == null ? "-" : `¥${Math.round(conservativeExit).toLocaleString()}`}</span>
                    </div>
                  )}
                </CardFooter>
              </Card>
            );
          },
          [t, language, activeGame, exitPercentile]
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
