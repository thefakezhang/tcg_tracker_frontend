"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RowSelectionState } from "@tanstack/react-table";
import { ChevronDown, CircleAlert, Hash, Minus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
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
import { AddToPlanAction } from "./AddToPlanAction";
import { useGame } from "./GameContext";
import { useHeader } from "./HeaderContext";
import { useAvailableCardSources, useCardData, useLaneSourceOptions, type CardRowData, type RegionFilter, cardVariant, getCardDisplayName } from "./use-card-data";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "./LanguageContext";
import { createColumns, createMtgColumns, createSelectColumn, PriceCell } from "./columns";
import { MtgPrintingBadges } from "./MtgPrintingBadges";
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
import DecisionOutcomes from "./DecisionOutcomes";
import { DecisionActions } from "./DecisionActions";
import { browserOpportunityPayloads, recordOpportunityExposures } from "./opportunity-exposures";
import { sourceLabel } from "@/lib/source-labels";
import type { SourceSide } from "./source-availability";
import {
  laneSourceSets,
  regionTick,
  soleTickedRegion,
  withRegionExits,
  type LaneSourceOption,
} from "./lane-sources";
import { JapanExclusiveEvidence } from "./JapanExclusiveEvidence";
import { MtgLabelEvidence } from "./MtgLabelEvidence";
import type { JapanExclusivityDimension } from "./japan-exclusivity";
import { JapanExclusivityFilter } from "./JapanExclusivityFilter";
import { MTG_TAG_DIMENSIONS, type MtgTagDimension } from "./mtg-tags";
import {
  ownedInventoryKey,
  useOwnedInventoryCounts,
  type OwnedInventoryIdentity,
} from "./owned-inventory";
import { OwnedCountLine, ObservedLine } from "./OwnedCountLine";
import { useCardObservations } from "./card-observations";
import { QueryError } from "./use-query";
import { activateOnEnterOrSpace } from "@/lib/keyboard-activation";
import { MarketEvidenceBadge } from "./MarketEvidenceCallout";
import { formatJpy, formatRoi, formatUsdCompact } from "@/lib/money";
import {
  buildMarketEvidenceMaps,
  buildTcgMarketMap,
  type MarketEvidence,
  type MarketPriceRow,
} from "./market-evidence";

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

// Lane source options grouped by region for the "Buy at" and "Sell to" menus:
// NA first, then JP, then anything else by name.
function optionsByRegion(options: readonly LaneSourceOption[]): [string, LaneSourceOption[]][] {
  const groups = new Map<string, LaneSourceOption[]>();
  for (const option of options) {
    const region = option.region ?? "";
    groups.set(region, [...(groups.get(region) ?? []), option]);
  }
  const rank = (region: string) => (region === "NA" ? 0 : region === "JP" ? 1 : 2);
  return [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

// Compact USD for the tcgplayer market value: whole dollars once it's meaningful,
// cents for the sub-$100 long tail.
function fmtUsd(n: number): string {
  return formatUsdCompact(n);
}

export default function CardBrowser() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { activeGame, psaMode, setPsaMode } = useGame();
  const { exitPercentile, setExitPercentile } = useExitBasis();
  const { setHeaderActions } = useHeader();
  const [search, setSearch] = useState("");
  // Card number is split into numerator ("123") and the slash-suffix ("078")
  // so a shop lookup can change just one part - no caret-positioning inside a
  // "123/078" string and no keyboard switch to type the slash on mobile. The
  // suffix is sticky, so stepping through one set only touches the numerator.
  const [cardNum, setCardNum] = useState("");
  const [cardDenom, setCardDenom] = useState("");
  const searchCardNumber = [cardNum.trim(), cardDenom.trim()].filter(Boolean).join("/");
  // Pasting/typing a full "217/172" into either box still works: a slash splits
  // it across both fields instead of stuffing the whole string into one.
  const setCardNumberPart = (part: "num" | "denom", raw: string) => {
    if (raw.includes("/")) {
      const i = raw.indexOf("/");
      setCardNum(raw.slice(0, i));
      setCardDenom(raw.slice(i + 1));
      return;
    }
    (part === "num" ? setCardNum : setCardDenom)(raw);
  };
  const [searchSetCode, setSearchSetCode] = useState("");
  const [selectedTier, setSelectedTier] = useState(1);
  const [sellRegion, setSellRegion] = useState<RegionFilter>("all");
  // The shop filter, read from the operator's side (#2927). Pokemon: the shop
  // to buy at, always the "sell" side (the shop sells, we buy), which
  // recomputes each card's lane. MTG: one shop on either side, a presence gate.
  const [requiredSource, setRequiredSource] = useState("");
  const [sourceSide, setSourceSide] = useState<SourceSide>("sell");
  // Pokemon "Sell to": exit sources left out of each card's lane
  // (lane-sources.ts). Exclusions rather than inclusions, so a new source is in
  // by default.
  const [excludedExits, setExcludedExits] = useState<string[]>([]);
  const [rarity, setRarity] = useState<string>("");          // "" = all (Pokémon only)
  const [promosOnly, setPromosOnly] = useState(false);       // Pokémon promotional cards
  const [japanExclusivity, setJapanExclusivity] = useState<Set<JapanExclusivityDimension>>(() => new Set());
  // MTG tags: opt-in sets a card belongs to. Reserved List today; the cEDH and
  // commander tags land here once a play-rate source exists.
  const [mtgTags, setMtgTags] = useState<Set<MtgTagDimension>>(() => new Set());
  const [cuteOnly, setCuteOnly] = useState(false); // manual "cute" flag (293)
  // Exit must be a completed transaction rather than a third party's estimate.
  const [soldEvidenceOnly, setSoldEvidenceOnly] = useState(false);
  // Off by default, deliberately. An unmeasured exit is still the best figure
  // available for that card, so hiding it without being asked would lose rows
  // rather than qualify them; the marker in PriceCell is what makes the state
  // visible, and this is for when the operator wants them gone.
  const [measuredExitsOnly, setMeasuredExitsOnly] = useState(false);
  const [minBuyPrice, setMinBuyPrice] = useState<string>("");
  const [minSellPrice, setMinSellPrice] = useState<string>("");
  const [roiFloor, setRoiFloor] = useState<string>("");
  const [roiCeiling, setRoiCeiling] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false); // mobile: advanced filters collapsed behind a toggle
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [sortColumn, setSortColumn] = useState("roi");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [selectedCard, setSelectedCard] = useState<CardRowData | null>(null);
  // #2 (show feedback): a per-card tcgplayer market value (USD), fetched for the
  // loaded page from the pokemon_tcgplayer_market view, so the browse can show
  // it prominently on mobile and sum it across a multi-selection.
  const [tcgMarket, setTcgMarket] = useState<Map<number, number>>(() => new Map());
  const [marketEvidence, setMarketEvidence] = useState<Map<number, MarketEvidence>>(() => new Map());
  const [weakEvidenceOnly, setWeakEvidenceOnly] = useState(false);
  const [surface, setSurface] = useState<"browse" | "watchlist" | "outcomes">("browse");

  useEffect(() => {
    if (window.matchMedia?.("(max-width: 639px)").matches) setViewMode("grid");
  }, []);

  const [refreshOpen, setRefreshOpen] = useState(false);
  // Multi-select, Pokemon singles only. It existed for targeted price refresh
  // (redesign R6), which was retired on 2026-10-05; AddToPlanAction is now the
  // only consumer, and it is Pokemon-scoped for the same identity reason.
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const selectionEnabled = activeGame === "pokemon";
  // MTG's shop filter offers both sides from the per-source snapshot.
  const availableSources = useAvailableCardSources(activeGame);
  // Pokemon offers the sources its lanes can use, cardladder included; the
  // per-source snapshot behind availableSources leaves cardladder out.
  const laneOptions = useLaneSourceOptions(activeGame);
  const exitOptionSources = useMemo(
    () => [...new Set(laneOptions.exit.map((option) => option.source))],
    [laneOptions.exit],
  );
  const entryByRegion = useMemo(() => optionsByRegion(laneOptions.entry), [laneOptions.entry]);
  const exitByRegion = useMemo(() => optionsByRegion(laneOptions.exit), [laneOptions.exit]);
  const laneSources = useMemo(
    () => laneSourceSets({
      game: activeGame,
      buyAt: sourceSide === "sell" ? requiredSource : "",
      excludedExits,
      exitOptions: exitOptionSources,
    }),
    [activeGame, requiredSource, sourceSide, excludedExits, exitOptionSources],
  );
  const includedExits = exitOptionSources.filter((source) => !excludedExits.includes(source));
  const regionLabel = (region: string) =>
    region === "NA" ? t("cardBrowser.regionNA") : region === "JP" ? t("cardBrowser.regionJP") : region;
  const soleExitRegion = soleTickedRegion(exitByRegion, excludedExits);
  const sellToLabel = excludedExits.length === 0
    ? t("cardBrowser.sellToAll")
    : includedExits.length === 0
      ? t("cardBrowser.sellToNone")
      : includedExits.length === 1
        ? `${t("cardBrowser.sellToPrefix")}${sourceLabel(includedExits[0])}`
        : soleExitRegion !== null
          ? t("cardBrowser.sellToRegionOnly", { region: regionLabel(soleExitRegion) })
          : excludedExits.length === 1
            ? t("cardBrowser.sellToWithout", { source: sourceLabel(excludedExits[0]) })
            : t("cardBrowser.sellToSome", { count: includedExits.length });
  const shopLabel = requiredSource
    ? `${t(sourceSide === "sell" ? "cardBrowser.buyAtPrefix" : "cardBrowser.sellToPrefix")}${sourceLabel(requiredSource)}`
    : t(activeGame === "pokemon" ? "cardBrowser.buyAtAll" : "cardBrowser.shopAll");

  const { data, loading, error, availableTiers, totalCount, refetch, refresh } =
    useCardData({
      activeGame,
      psaMode,
      search,
      searchCardNumber,
      searchSetCode,
      selectedTier,
      sellRegion,
      requiredSource,
      sourceSide,
      laneSources,
      rarity: rarity || null,
      promosOnly,
      soldEvidenceOnly,
      measuredExitsOnly,
      japanExclusivity,
      mtgTags,
      cuteOnly,
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

  const ownedIdentities = useMemo<OwnedInventoryIdentity[]>(
    () => data.map((row) => ({
      game: activeGame,
      cardId: row.card.card_id,
    })),
    [activeGame, data],
  );
  const ownedCounts = useOwnedInventoryCounts(activeGame, ownedIdentities);
  const observations = useCardObservations(
    activeGame,
    useMemo(() => data.map((row) => row.card.card_id), [data]),
  );
  const dataWithOwned = useMemo(
    () => data.map((row) => {
      const counts = ownedCounts.get(ownedInventoryKey({
        game: activeGame,
        cardId: row.card.card_id,
      }));
      return {
        ...row,
        ownedQty: counts?.owned ?? 0,
        incomingQty: counts?.incoming ?? 0,
        ownedAvgCostUsd: counts?.avgCost ?? null,
        ownedCostBasisUsd: counts?.costBasis ?? null,
        ownedConsigned: counts?.consigned ?? 0,
        observed: observations.get(String(row.card.card_id)),
      };
    }),
    [activeGame, data, ownedCounts, observations],
  );
  const visibleData = useMemo(
    () => weakEvidenceOnly
      ? dataWithOwned.filter((row) =>
          isHighValueWeakEvidence(row.signal, row.jpyUsd)
        )
      : dataWithOwned,
    [dataWithOwned, weakEvidenceOnly],
  );

  // A card can occupy two rows (PSA and non-PSA share a card_id), so dedupe -
  // the RPC should be asked once per card.
  const selectedCards = useMemo(() => {
    if (!selectionEnabled) return [];
    // Carry the name, not just the id. The plan dialog asks for a quantity per
    // card, and "card 803169" is not something anyone can answer that for.
    const byId = new Map<number, { id: number; name: string }>();
    for (const row of data) {
      if (!rowSelection[row.key]) continue;
      const id = Number(row.card.card_id);
      if (!byId.has(id)) byId.set(id, { id, name: getCardDisplayName(row.card, language) });
    }
    return [...byId.values()];
  }, [data, rowSelection, selectionEnabled, language]);
  const selectedCardIds = useMemo(() => selectedCards.map((c) => c.id), [selectedCards]);

  // Load TCGPlayer and Collectr raw-market values for the cards currently on
  // screen. Evidence is classified only when both queries succeed, so a source
  // outage can never appear as a real Collectr-only card.
  useEffect(() => {
    setTcgMarket(new Map());
    setMarketEvidence(new Map());
    if (activeGame !== "pokemon") return;
    const ids = [...new Set(data.map((r) => Number(r.card.card_id)).filter((n) => Number.isFinite(n)))];
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [tcgplayer, collectr] = await Promise.all([
        supabase
          .from("pokemon_tcgplayer_market")
          .select("card_id, market_usd")
          .in("card_id", ids),
        supabase
          .from("pokemon_market_listings")
          .select("card_id, price, locations!inner(name)")
          .in("card_id", ids)
          .eq("price_type", "Sell")
          .eq("psa_grade", 0)
          .eq("currency", "USD")
          .eq("locations.name", "collectr"),
      ]);
      if (cancelled) return;

      if (!tcgplayer.error) {
        setTcgMarket(buildTcgMarketMap((tcgplayer.data ?? []) as MarketPriceRow[]));
      }
      if (!tcgplayer.error && !collectr.error) {
        const maps = buildMarketEvidenceMaps(
          ids,
          (tcgplayer.data ?? []) as MarketPriceRow[],
          (collectr.data ?? []) as MarketPriceRow[],
        );
        setMarketEvidence(maps.evidence);
      }
    })();
    return () => { cancelled = true; };
  }, [data, activeGame]);

  // Collective tcgplayer market value over the current selection (the "list on
  // tcgplayer" the operator used to build by hand). priced < count when some
  // selected cards have no tcgplayer market on file.
  const selectedMarket = useMemo(() => {
    let total = 0, priced = 0;
    for (const id of selectedCardIds) {
      const v = tcgMarket.get(id);
      if (v != null) { total += v; priced++; }
    }
    return { total, priced };
  }, [selectedCardIds, tcgMarket]);

  // Reset filters on game change
  useEffect(() => {
    setSearch("");
    setCardNum("");
    setCardDenom("");
    setSearchSetCode("");
    setSelectedTier(1);
    setSellRegion("all");
    setRequiredSource("");
    setSourceSide("sell");
    setExcludedExits((current) => current.length === 0 ? current : []);
    setRarity("");
    setPromosOnly(false);
    setJapanExclusivity((current) => current.size === 0 ? current : new Set());
    setWeakEvidenceOnly(false);
    setMinBuyPrice("");
    setMinSellPrice("");
    setRoiFloor("");
    setRoiCeiling("");
    setSortColumn("roi");
    setSortAsc(false);
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
  }, [search, searchCardNumber, searchSetCode, selectedTier, sellRegion, requiredSource, sourceSide, excludedExits, rarity, promosOnly, soldEvidenceOnly, measuredExitsOnly, japanExclusivity, mtgTags, cuteOnly, minBuyPrice, minSellPrice, roiFloor, roiCeiling, psaMode, sortColumn, sortAsc, pageSize]);

  useEffect(() => {
    setHeaderActions(null);
    return () => setHeaderActions(null);
  }, [setHeaderActions]);

  useEffect(() => {
    if (activeGame !== "pokemon" || loading || surface !== "browse") return;
    const exposures = browserOpportunityPayloads(visibleData, viewMode === "grid" ? "browser_grid" : "browser_list");
    void recordOpportunityExposures(exposures).catch((exposureError) => {
      console.error("Failed to record displayed opportunities:", exposureError);
    });
  }, [activeGame, loading, surface, viewMode, visibleData]);

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

  const cardDetailLabel = (row: CardRowData) => {
    const identity = [
      getCardDisplayName(row.card, language),
      row.card.set_code !== "UNKNOWN" ? row.card.set_code : null,
      row.card.card_number !== "UNKNOWN" ? row.card.card_number : null,
    ].filter(Boolean).join(" ");
    return t("cardBrowser.openDetails", { card: identity });
  };

  const columnVisibility = {
    psa_grade: psaMode === "psa",
  };

  const surfaceTabs = (
    <Tabs value={surface} onValueChange={(value) => setSurface(String(value) as "browse" | "watchlist" | "outcomes")}>
      <TabsList className="h-11 sm:h-8">
        <TabsTrigger value="browse">{t("decision.browse")}</TabsTrigger>
        <TabsTrigger value="watchlist">{t("decision.watchlist")}</TabsTrigger>
        <TabsTrigger value="outcomes">{t("outcomes.tab")}</TabsTrigger>
      </TabsList>
    </Tabs>
  );

  if (activeGame === "pokemon" && surface === "watchlist") {
    return <div className="space-y-4">{surfaceTabs}<DecisionWatchlist /></div>;
  }
  if (activeGame === "pokemon" && surface === "outcomes") {
    return <div className="space-y-4">{surfaceTabs}<DecisionOutcomes /></div>;
  }

  return (
    <div className="space-y-4">
      {activeGame === "pokemon" && surfaceTabs}
      {/* Sticky search: the primary lookup stays pinned at the top on mobile
          instead of scrolling away behind a long result list (show feedback). */}
      <div className="sticky top-0 z-20 space-y-2 bg-background pb-2 pt-1">
      <div data-testid="browser-search-grid" className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:gap-2 [&_input]:h-11 sm:[&_input]:h-8">
        <label className="space-y-1 sm:col-span-2">
          <span className="text-xs font-medium text-muted-foreground sm:sr-only">{t("cardBrowser.nameLabel")}</span>
          <Input
            type="text"
            placeholder={t("cardBrowser.namePlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {/* Split card number: numeric numerator + a sticky suffix, joined by a
            static "/" you never type. Editing one part is one tap, not a caret
            hunt inside "123/078", and the numerator gets a numeric keypad. */}
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-muted-foreground sm:sr-only">{t("cardBrowser.cardNumberLabel")}</legend>
          <div className="flex items-center gap-1">
          <Input
            type="text"
            inputMode="numeric"
            placeholder={t("cardBrowser.cardNumberNumerator")}
            aria-label={t("cardBrowser.cardNumberNumerator")}
            value={cardNum}
            onChange={(e) => setCardNumberPart("num", e.target.value)}
            className="min-w-0 flex-1"
          />
          <span className="shrink-0 text-muted-foreground" aria-hidden="true">/</span>
          <Input
            type="text"
            placeholder={t("cardBrowser.cardNumberDenominator")}
            aria-label={t("cardBrowser.cardNumberDenominator")}
            value={cardDenom}
            onChange={(e) => setCardNumberPart("denom", e.target.value)}
            className="min-w-0 flex-1"
          />
          </div>
        </fieldset>
        <label className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground sm:sr-only">{t("cardBrowser.setCodeLabel")}</span>
          <Input
            type="text"
            placeholder={t("cardBrowser.setCodePlaceholder")}
            value={searchSetCode}
            onChange={(e) => setSearchSetCode(e.target.value)}
          />
        </label>
      </div>
      {/* Mobile-only toggle so the advanced filters don't bury the search bar. */}
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full justify-center sm:hidden"
        onClick={() => setShowFilters((v) => !v)}
      >
        {t("cardBrowser.filters")}
        <ChevronDown className={`ml-1 size-4 transition-transform ${showFilters ? "rotate-180" : ""}`} />
      </Button>
      </div>
      <div className={`flex-wrap items-center gap-2 ${showFilters ? "flex" : "hidden"} sm:flex`}>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" className="h-11 shrink-0 sm:h-8" />
            }
          >
            {t("cardBrowser.buyInPrefix")}
            {sellRegion === "all" ? t("cardBrowser.regionAll") : regionLabel(sellRegion)}
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
        {activeGame === "pokemon" ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant={requiredSource ? "default" : "outline"}
                  className="h-11 shrink-0 sm:h-8"
                  data-testid="browser-buy-at"
                />
              }
              title={t("cardBrowser.buyAtHint")}
            >
              {shopLabel}
              <ChevronDown className="ml-1 size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-80 overflow-auto">
              <DropdownMenuRadioGroup
                value={requiredSource}
                onValueChange={(source) => {
                  setSourceSide("sell");
                  setRequiredSource(source);
                }}
              >
                <DropdownMenuRadioItem value="" className="min-h-11 sm:min-h-0">
                  {t("cardBrowser.buyAtAny")}
                </DropdownMenuRadioItem>
                {entryByRegion.map(([region, options]) => (
                  <DropdownMenuGroup key={region || "other"}>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>{regionLabel(region)}</DropdownMenuLabel>
                    {options.map((option) => (
                      <DropdownMenuRadioItem
                        key={`${region}:${option.source}`}
                        value={option.source}
                        className="min-h-11 sm:min-h-0"
                        data-source={option.source}
                      >
                        {sourceLabel(option.source)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuGroup>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant={requiredSource ? "default" : "outline"}
                  className="h-11 shrink-0 sm:h-8"
                  data-testid="browser-shop"
                />
              }
              title={t("cardBrowser.shopHint")}
            >
              {shopLabel}
              <ChevronDown className="ml-1 size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-80 overflow-auto">
              <DropdownMenuRadioGroup
                value={requiredSource ? `${sourceSide}:${requiredSource}` : ""}
                onValueChange={(value) => {
                  const at = value.indexOf(":");
                  setSourceSide(at > 0 && value.slice(0, at) === "buy" ? "buy" : "sell");
                  setRequiredSource(at > 0 ? value.slice(at + 1) : "");
                }}
              >
                <DropdownMenuRadioItem value="" className="min-h-11 sm:min-h-0">
                  {t("cardBrowser.shopAny")}
                </DropdownMenuRadioItem>
                {(["sell", "buy"] as const).map((side) => availableSources[side].length > 0 && (
                  <DropdownMenuGroup key={side}>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>
                      {t(side === "sell" ? "cardBrowser.shopBuyAtGroup" : "cardBrowser.shopSellToGroup")}
                    </DropdownMenuLabel>
                    {availableSources[side].map((source) => (
                      <DropdownMenuRadioItem
                        key={`${side}:${source}`}
                        value={`${side}:${source}`}
                        className="min-h-11 sm:min-h-0"
                        data-source={source}
                      >
                        {sourceLabel(source)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuGroup>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {activeGame === "pokemon" && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant={excludedExits.length > 0 ? "default" : "outline"}
                  className="h-11 shrink-0 sm:h-8"
                  data-testid="browser-sell-to"
                />
              }
              title={t("cardBrowser.sellToHint")}
            >
              {sellToLabel}
              <ChevronDown className="ml-1 size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-80 overflow-auto">
              <DropdownMenuItem
                disabled={excludedExits.length === 0}
                onClick={() => setExcludedExits([])}
                className="min-h-11 sm:min-h-0"
              >
                {t("cardBrowser.sellToReset")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={includedExits.length === 0}
                onClick={() => setExcludedExits([...exitOptionSources])}
                className="min-h-11 sm:min-h-0"
              >
                {t("cardBrowser.sellToClear")}
              </DropdownMenuItem>
              {exitByRegion.map(([region, options]) => {
                const regionSources = options.map((option) => option.source);
                const tick = regionTick(regionSources, excludedExits);
                return (
                <DropdownMenuGroup key={region || "other"}>
                  <DropdownMenuSeparator />
                  {/* The region heading is itself a tick box: it ticks or
                      unticks every site in the region at once. */}
                  <DropdownMenuCheckboxItem
                    checked={tick.state === "all"}
                    onCheckedChange={() =>
                      setExcludedExits((current) =>
                        withRegionExits(
                          current,
                          regionSources,
                          regionTick(regionSources, current).state !== "all",
                        ))}
                    className="min-h-11 font-medium sm:min-h-0"
                    data-region={region || "other"}
                    data-tick={tick.state}
                    title={t("cardBrowser.sellToRegionHint", { region: regionLabel(region) })}
                  >
                    {regionLabel(region)}
                    {tick.state === "some" && (
                      <>
                        <span className="text-xs font-normal text-muted-foreground">
                          {t("cardBrowser.sellToRegionCount", { included: tick.included, total: tick.total })}
                        </span>
                        <span
                          aria-hidden
                          className="pointer-events-none absolute right-2 flex items-center justify-center"
                        >
                          <Minus className="size-4" />
                        </span>
                      </>
                    )}
                  </DropdownMenuCheckboxItem>
                  {options.map((option) => (
                    <DropdownMenuCheckboxItem
                      inset
                      key={`${region}:${option.source}`}
                      checked={!excludedExits.includes(option.source)}
                      onCheckedChange={(checked) =>
                        setExcludedExits((current) =>
                          checked
                            ? current.filter((source) => source !== option.source)
                            : current.includes(option.source)
                              ? current
                              : [...current, option.source])}
                      className="min-h-11 sm:min-h-0"
                      data-source={option.source}
                    >
                      {sourceLabel(option.source)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {activeGame === "pokemon" && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" className="h-11 shrink-0 sm:h-8" />}>
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
          <JapanExclusivityFilter
            selected={japanExclusivity}
            onToggle={(dimension) => setJapanExclusivity((current) => {
              const next = new Set(current);
              if (next.has(dimension)) next.delete(dimension);
              else next.add(dimension);
              return next;
            })}
          />
        )}
        {activeGame === "mtg" && MTG_TAG_DIMENSIONS.map((dimension) => (
          <Button
            key={dimension}
            variant={mtgTags.has(dimension) ? "default" : "outline"}
            className="h-11 shrink-0 sm:h-8"
            onClick={() => setMtgTags((current) => {
              const next = new Set(current);
              if (next.has(dimension)) next.delete(dimension);
              else next.add(dimension);
              return next;
            })}
            title={t(`cardBrowser.${dimension}Hint`)}
          >
            {t(`cardBrowser.${dimension}`)}
          </Button>
        ))}
        <Button
          variant={soldEvidenceOnly ? "default" : "outline"}
          className="h-11 shrink-0 sm:h-8"
          onClick={() => setSoldEvidenceOnly((v) => !v)}
          title={t("cardBrowser.soldEvidenceOnlyHint")}
        >
          {t("cardBrowser.soldEvidenceOnly")}
        </Button>
        <Button
          variant={measuredExitsOnly ? "default" : "outline"}
          className="h-11 shrink-0 sm:h-8"
          onClick={() => setMeasuredExitsOnly((v) => !v)}
          title={t("cardBrowser.measuredExitsOnlyHint")}
        >
          {t("cardBrowser.measuredExitsOnly")}
        </Button>
        {activeGame === "pokemon" && (
          <Button
            variant={cuteOnly ? "default" : "outline"}
            className="h-11 shrink-0 sm:h-8"
            onClick={() => setCuteOnly((v) => !v)}
          >
            {t("cardBrowser.cuteOnly")}
          </Button>
        )}
        <div
          data-testid="browser-price-filters"
          className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:w-auto xl:flex-1 xl:grid-cols-4"
        >
          <Input
            type="number"
            placeholder={t("cardBrowser.minBuyPrice")}
            aria-label={t("cardBrowser.minBuyPrice")}
            value={minBuyPrice}
            onChange={(e) => setMinBuyPrice(e.target.value)}
            className="h-11 w-full min-w-0 sm:h-8"
          />
          <Input
            type="number"
            placeholder={t("cardBrowser.minSellPrice")}
            aria-label={t("cardBrowser.minSellPrice")}
            value={minSellPrice}
            onChange={(e) => setMinSellPrice(e.target.value)}
            className="h-11 w-full min-w-0 sm:h-8"
          />
          <Input
            type="number"
            placeholder={t("cardBrowser.roiFloor")}
            aria-label={t("cardBrowser.roiFloor")}
            value={roiFloor}
            onChange={(e) => setRoiFloor(e.target.value)}
            className="h-11 w-full min-w-0 sm:h-8"
          />
          <Input
            type="number"
            placeholder={t("cardBrowser.roiCeiling")}
            aria-label={t("cardBrowser.roiCeiling")}
            value={roiCeiling}
            onChange={(e) => setRoiCeiling(e.target.value)}
            className="h-11 w-full min-w-0 sm:h-8"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={viewMode}
          onValueChange={(v) => setViewMode(String(v) as "list" | "grid")}
          className="shrink-0"
        >
          <TabsList className="h-11 sm:h-8">
            <TabsTrigger className="min-w-11 sm:min-w-0" value="list">{t("cardBrowser.list")}</TabsTrigger>
            <TabsTrigger className="min-w-11 sm:min-w-0" value="grid">{t("cardBrowser.grid")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <AlertDialog open={refreshOpen} onOpenChange={setRefreshOpen}>
          <AlertDialogTrigger
            render={
              <Button
                variant="outline"
                size="icon"
                disabled={loading}
                className="size-11 shrink-0 sm:size-8"
                aria-label={t("refresh.confirm")}
                title={t("refresh.confirm")}
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
        <div className="flex w-full flex-wrap items-center justify-end gap-2 xl:ml-auto xl:w-auto">
          {activeGame === "pokemon" && (
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              {t("evidence.exitBasis")}
              <select
                className="h-11 rounded-md border bg-background px-2 text-foreground sm:h-8"
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
              className="h-11 shrink-0 px-3 text-sm sm:h-7 sm:px-2.5 sm:text-[0.8rem]"
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
                  <Button variant="outline" className="h-11 shrink-0 sm:h-8" />
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
              <TabsList className="h-11 sm:h-8">
                <TabsTrigger value="non-psa">{t("modal.tabNonPsa")}</TabsTrigger>
                <TabsTrigger value="psa">{t("modal.tabPsa")}</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>
      </div>

      {error && (
        <QueryError error={error} onRetry={refetch} />
      )}

      {selectionEnabled && selectedCardIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-muted-foreground text-xs">
            {t("cardBrowser.selectedCount", { count: selectedCardIds.length })}
          </span>
          {selectedMarket.priced > 0 && (
            <span className="text-xs font-medium">
              {t("cardBrowser.selectionMarketTotal", { total: fmtUsd(selectedMarket.total) })}
              {selectedMarket.priced < selectedCardIds.length && (
                <span className="text-muted-foreground font-normal">
                  {" "}
                  {t("cardBrowser.selectionMarketPriced", { priced: selectedMarket.priced, count: selectedCardIds.length })}
                </span>
              )}
            </span>
          )}
          {/* Selecting cards here is where the operator decides what to buy, so
              this is where adding to a plan belongs - it used to be possible
              only one card at a time, inside the planner. */}
          <AddToPlanAction cards={selectedCards} />
        </div>
      )}

      {(!error || visibleData.length > 0) && <DataTable
        columns={activeGame === "mtg"
          ? createMtgColumns(t, language)
          : [createSelectColumn(t), ...createColumns(
              t,
              language,
              tcgMarket,
              marketEvidence,
            )]}
        data={visibleData}
        loading={loading}
        sorting={sorting}
        onSortingChange={handleSortingChange}
        columnVisibility={columnVisibility}
        onRowClick={setSelectedCard}
        getRowAriaLabel={cardDetailLabel}
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
        renderGridItem={(row: CardRowData, selection) => {
            const misc = cardVariant(row.card);
            const cardNumber =
              row.card.card_number && row.card.card_number !== "UNKNOWN"
                ? row.card.card_number
                : null;
            const setCode =
              row.card.set_code && row.card.set_code !== "UNKNOWN"
                ? row.card.set_code
                : null;
            const compactIdentity = cardNumber && setCode
              ? setCode.endsWith("-P") && !cardNumber.includes("/")
                ? `${cardNumber}/${setCode}`
                : `${setCode} · ${cardNumber}`
              : cardNumber ?? setCode;
            const buyEntry = row.prices.highestBuy;
            const sellEntry = row.prices.lowestSell;
            const conservativeExit = exitValue(row.signal, exitPercentile);
            const rawMarketEvidence = Number(row.psaGrade ?? 0) === 0
              ? marketEvidence.get(Number(row.card.card_id))
              : undefined;

            return (
              <Card
                size="sm"
                data-selected={selection?.selected ? "true" : undefined}
                className={`relative h-full cursor-pointer gap-0 !py-0 outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring ${
                  selection?.selected ? "ring-2 ring-primary" : ""
                }`}
                role="button"
                tabIndex={0}
                aria-label={cardDetailLabel(row)}
                onClick={() => setSelectedCard(row)}
                onKeyDown={(event) => activateOnEnterOrSpace(
                  event,
                  () => setSelectedCard(row),
                )}
              >
                {selection && (
                  // Sits over the art, and stops the click from opening the card
                  // detail the tile itself is bound to.
                  <label
                    className="absolute top-0 left-0 z-10 inline-flex size-11 cursor-pointer items-center justify-center"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      aria-label={t("cardBrowser.selectCard", { name: getCardDisplayName(row.card, language) })}
                      className="size-6 cursor-pointer rounded bg-background/90 shadow-sm sm:size-5"
                      checked={selection.selected}
                      onChange={(event) => selection.toggle(event.target.checked)}
                    />
                  </label>
                )}
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
                      {activeGame === "mtg" && <MtgPrintingBadges card={row.card} />}
                      {compactIdentity && (
                        <Badge variant="secondary" className="h-auto px-1.5 py-px">
                          <Hash className="size-3" />
                          {compactIdentity}
                        </Badge>
                      )}
                    </div>
                  </CardAction>
                  <CardTitle className="truncate text-lg">{getCardDisplayName(row.card, language)}</CardTitle>
                  {misc && (
                    <CardDescription className="truncate text-xs">
                      {misc}
                    </CardDescription>
                  )}
                  <JapanExclusiveEvidence card={row.card} compact />
                  <MtgLabelEvidence card={row.card} compact />
                  <OwnedCountLine owned={row.ownedQty} incoming={row.incomingQty} avgCost={row.ownedAvgCostUsd} totalCost={row.ownedCostBasisUsd} consigned={row.ownedConsigned} />
                  <ObservedLine observed={row.observed} />
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
                    <span>{formatRoi(row.roi)}</span>
                  </div>
                  {activeGame === "pokemon" && tcgMarket.get(Number(row.card.card_id)) != null && (
                    <div className="flex w-full justify-between gap-2 border-t border-foreground/10 pt-2">
                      <span className="text-muted-foreground">{t("cardBrowser.tcgMarket")}</span>
                      <span className="font-medium">{fmtUsd(tcgMarket.get(Number(row.card.card_id))!)}</span>
                    </div>
                  )}
                  {activeGame === "pokemon" && (
                    rawMarketEvidence?.status === "collectr_only"
                    || rawMarketEvidence?.status === "discrepant"
                  ) && (
                    <div className="flex w-full justify-end border-t border-foreground/10 pt-2">
                      <MarketEvidenceBadge evidence={rawMarketEvidence} />
                    </div>
                  )}
                  {activeGame === "pokemon" && (
                    <div className="flex w-full justify-between gap-2 border-t border-foreground/10 pt-2">
                      <span className="text-muted-foreground">P{exitPercentile} {t("column.conservativeExit")}</span>
                      <span>{conservativeExit == null ? "-" : formatJpy(conservativeExit)}</span>
                    </div>
                  )}
                  {activeGame === "pokemon" && (
                    <div className="flex w-full justify-end border-t border-foreground/10 pt-2">
                      <DecisionActions row={row} />
                    </div>
                  )}
                </CardFooter>
              </Card>
            );
          }}
      />}

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
