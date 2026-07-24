"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, DollarSign, ExternalLink, Hash, Layers, LoaderCircle, Plus, Sparkles, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { AddToLotPopover } from "./AddToLotPopover";
import { useGame } from "./GameContext";
import { useCurrency } from "./CurrencyContext";
import { useBuyList } from "./BuyListContext";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import {
  type CardDefinition,
  type CardRowData,
  type MarketListing,
  type LocationInfo,
  LISTINGS_TABLE_MAP,
  fetchRateMap,
  fetchLocationMap,
  fetchConditionsCache,
  getCardDisplayName,
} from "./use-card-data";
import { useLanguage } from "./LanguageContext";
import type { Game } from "./GameContext";
import { FreshnessChip } from "./FreshnessChip";
import { RefreshPricesAction } from "./RefreshPricesAction";
import { UidChip } from "./UidChip";
import { useOwnedInventoryVersion } from "./owned-inventory";
import GradeEvidencePanel from "./GradeEvidencePanel";
import { decisionSnapshot } from "./DecisionActions";
import { detailOpportunityPayloads, recordOpportunityExposures } from "./opportunity-exposures";

const BUYLIST_ENTRY_TABLE: Record<Game, string> = {
  pokemon: "pokemon_buylist_entries",
  mtg: "mtg_buylist_entries",
  pokemon_sealed: "pokemon_sealed_buylist_entries",
};

export interface DetailListing {
  price: number;
  currencySymbol: string;
  currencyCode: string;
  locationName: string;
  marketRegion: string | null;
  conditionLabel: string;
  conditionId: number | null;
  listingUrl: string | null;
  // pokemon_market_listings.last_updated; drives the freshness chip next
  // to the location. null when the row predates the column being populated.
  lastUpdated: string | null;
}

// TCGplayer's product page accepts query params to preselect a specific SKU
// (language + printing + condition). Deep-linking here saves the manual
// dropdown clicks after the user opens the listing, and disambiguates which
// exact SKU the DB price came from (Y'shtola FIC 207 JP non-foil vs EN non-foil
// share one product page).
const TCGPLAYER_CONDITION_NAMES: Record<number, string> = {
  1: "Near Mint",
  2: "Lightly Played",
  3: "Moderately Played",
  4: "Heavily Played",
  5: "Damaged",
};
function enhanceTCGplayerURL(
  url: string | null,
  card: CardDefinition,
  conditionId: number | null,
): string | null {
  if (!url || !url.includes("tcgplayer.com/product/")) return url;
  const params = new URLSearchParams();
  if (card.language === "en") params.set("Language", "English");
  else if (card.language === "jp") params.set("Language", "Japanese");
  if (card.is_foil === true) params.set("Printing", "Foil");
  else if (card.is_foil === false) params.set("Printing", "Normal");
  if (conditionId != null && TCGPLAYER_CONDITION_NAMES[conditionId]) {
    params.set("Condition", TCGPLAYER_CONDITION_NAMES[conditionId]);
  }
  const q = params.toString();
  if (!q) return url;
  return url + (url.includes("?") ? "&" : "?") + q;
}

// One on-hand SKU row for the opened card (H1): condition/grade split of the
// operator's finalized holdings, legs collapsed client-side.
interface HeldRow {
  condition_id: number | null;
  psa_grade: number | null;
  qty_on_hand: number;
}

interface CardDetailModalProps {
  card: CardRowData | null;
  open: boolean;
  onClose: () => void;
  initialPsaMode?: "non-psa" | "psa";
  initialTier?: number;
  onRemoveFromBuylist?: () => Promise<void> | void;
  entryGame?: Game;
  entryId?: number;
  targetPriceUsd?: number | null;
  onTargetPriceChange?: (entryId: number, price: number | null) => void;
}

export default function CardDetailModal({
  card,
  open,
  onClose,
  initialPsaMode = "non-psa",
  initialTier = 1,
  onRemoveFromBuylist,
  entryGame,
  entryId,
  targetPriceUsd,
  onTargetPriceChange,
}: CardDetailModalProps) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { activeGame } = useGame();
  const { buylists, addToBuylist } = useBuyList();
  const [addedTo, setAddedTo] = useState<string | null>(null);
  const [rawListings, setRawListings] = useState<MarketListing[]>([]);
  const [heldRows, setHeldRows] = useState<HeldRow[]>([]);
  const [incomingQty, setIncomingQty] = useState(0);
  const [rateMap, setRateMap] = useState<Map<string, number>>(new Map());
  const [locationMap, setLocationMap] = useState<Map<number, LocationInfo>>(
    new Map()
  );
  const [conditionsMap, setConditionsMap] = useState<Map<number, number>>(
    new Map()
  );
  const [availableTiers, setAvailableTiers] = useState<number[]>([]);
  const [selectedTiers, setSelectedTiers] = useState<number[]>([initialTier]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"non-psa" | "psa">(initialPsaMode);
  const [targetPrice, setTargetPrice] = useState<string>("");
  const [savingTargetPrice, setSavingTargetPrice] = useState(false);
  const [jpExclusive, setJpExclusive] = useState(false);
  const [savingJp, setSavingJp] = useState(false);
  const [askingPrice, setAskingPrice] = useState("");
  const [askingCurrency, setAskingCurrency] = useState<"JPY" | "USD">("JPY");
  const [sightingGrade, setSightingGrade] = useState(0);
  // Re-fetch holdings when any lot write bumps the owned-inventory store
  // (e.g. the Bought flow adds a draft-lot line while this modal is open).
  const ownedVersion = useOwnedInventoryVersion();

  const defaultSightingGrade = useCallback((tab: "non-psa" | "psa") => {
    const rowGrade = Number(card?.psaGrade ?? 0);
    return tab === "psa" ? (rowGrade > 0 ? rowGrade : 10) : 0;
  }, [card]);

  // Sync the manual JP-exclusive flag from the opened card.
  useEffect(() => {
    setJpExclusive(!!card?.card.is_japan_exclusive);
    setAskingPrice("");
    setAskingCurrency("JPY");
  }, [card]);

  const toggleJpExclusive = useCallback(async () => {
    if (!card || savingJp) return;
    const next = !jpExclusive;
    setSavingJp(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_pokemon_japan_exclusive", {
      p_card_id: Number(card.card.card_id),
      p_value: next,
    });
    setSavingJp(false);
    if (!error) {
      setJpExclusive(next);
      card.card.is_japan_exclusive = next; // keep the row in sync for the list
    }
  }, [card, jpExclusive, savingJp]);

  const saveTargetPrice = useCallback(async () => {
    if (!entryGame || entryId == null || savingTargetPrice) return;
    const parsed = targetPrice === "" ? null : Number(targetPrice);
    if (parsed != null && (isNaN(parsed) || parsed < 0)) return;
    setSavingTargetPrice(true);
    const supabase = createClient();
    const { error } = await supabase
      .from(BUYLIST_ENTRY_TABLE[entryGame])
      .update({ target_price_usd: parsed })
      .eq("entry_id", entryId);
    if (error) {
      console.error("Failed to save target price:", error);
    } else {
      onTargetPriceChange?.(entryId, parsed);
    }
    setSavingTargetPrice(false);
  }, [entryGame, entryId, targetPrice, savingTargetPrice, onTargetPriceChange]);

  // Sync modal state with table filters when opening
  useEffect(() => {
    if (open) {
      setActiveTab(initialPsaMode);
      setSightingGrade(defaultSightingGrade(initialPsaMode));
      setSelectedTiers([initialTier]);
      setAddedTo(null);
      setTargetPrice(targetPriceUsd != null ? String(targetPriceUsd) : "");
    }
  }, [open, initialPsaMode, initialTier, targetPriceUsd, defaultSightingGrade]);

  useEffect(() => {
    if (!card || !open) return;

    let cancelled = false;
    setLoading(true);

    async function fetchListings() {
      const supabase = createClient();
      const [{ data: raw }, rates, locations, conditionsData, held, ownedCounts] =
        await Promise.all([
          supabase
            .from(LISTINGS_TABLE_MAP[activeGame])
            .select(
              "card_id, price_type, price, currency, psa_grade, condition, location_id, listing_url, last_updated, currencies(symbol)"
            )
            .eq("card_id", card!.card.card_id),
          fetchRateMap(supabase),
          fetchLocationMap(supabase),
          fetchConditionsCache(supabase),
          // H1: the operator's own copies, split by condition/grade (legs
          // collapse client-side) + the draft-lot incoming count.
          supabase
            .from("inventory_holdings_v")
            .select("condition_id, psa_grade, qty_on_hand")
            .eq("game", activeGame)
            .eq("card_id", card!.card.card_id),
          supabase
            .from("owned_inventory_counts_v")
            .select("qty_incoming")
            .eq("game", activeGame)
            .eq("card_id", card!.card.card_id),
        ]);

      if (cancelled) return;

      const listings: MarketListing[] = (raw ?? []).map(
        (l: Record<string, unknown>) => ({
          card_id: l.card_id as number,
          price_type: l.price_type as "Buy" | "Sell",
          price: l.price as number,
          currency: l.currency as string,
          currency_symbol:
            (l.currencies as { symbol: string } | null)?.symbol ?? "",
          psa_grade: l.psa_grade as number,
          condition: (l.condition as number | null) ?? null,
          location_id: l.location_id as number,
          listing_url: (l.listing_url as string | null) ?? null,
          last_updated: (l.last_updated as string | null) ?? null,
        })
      );

      setRawListings(listings);
      setHeldRows((held.data as HeldRow[] | null) ?? []);
      setIncomingQty(
        ((ownedCounts.data as { qty_incoming: number }[] | null) ?? [])
          .reduce((sum, row) => sum + Number(row.qty_incoming ?? 0), 0),
      );
      setRateMap(rates);
      setLocationMap(locations);
      setConditionsMap(conditionsData.map);
      setAvailableTiers(conditionsData.tiers);
      setLoading(false);
      if (activeGame === "pokemon") {
        void recordOpportunityExposures(detailOpportunityPayloads(card!, listings, locations)).catch((exposureError) => {
          console.error("Failed to record opened listing opportunities:", exposureError);
        });
      }
    }

    fetchListings();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, open, activeGame, ownedVersion]);

  const { buyNonPsa, sellNonPsa, buyPsa, sellPsa } = useMemo(() => {
    const normalize = (l: MarketListing) =>
      l.price * (rateMap.get(l.currency) ?? 1);

    const toDetail = (l: MarketListing): DetailListing => {
      let conditionLabel = "";
      if (l.psa_grade > 0) {
        conditionLabel = `PSA ${l.psa_grade}`;
      } else if (l.condition != null) {
        const tier = conditionsMap.get(l.condition);
        conditionLabel = tier != null ? `Tier ${tier}` : String(l.condition);
      }
      const loc = locationMap.get(l.location_id);
      return {
        price: l.price,
        currencySymbol: l.currency_symbol,
        currencyCode: l.currency,
        locationName: loc?.name ?? "",
        marketRegion: loc?.marketRegion ?? null,
        conditionLabel,
        conditionId: l.condition,
        listingUrl: card
          ? enhanceTCGplayerURL(l.listing_url, card.card, l.condition)
          : l.listing_url,
        lastUpdated: l.last_updated,
      };
    };

    const tierSet = new Set(selectedTiers);
    const nonPsa = rawListings.filter((l) => {
      if (l.psa_grade !== 0) return false;
      if (l.condition == null) return true;
      const tier = conditionsMap.get(l.condition);
      return tier != null && tierSet.has(tier);
    });
    const psa = rawListings.filter((l) => l.psa_grade > 0);

    const sortBuy = (a: MarketListing, b: MarketListing) =>
      normalize(b) - normalize(a);
    const sortSell = (a: MarketListing, b: MarketListing) =>
      normalize(a) - normalize(b);

    const buyNonPsaSorted = nonPsa
      .filter((l) => l.price_type === "Buy")
      .sort(sortBuy);
    const sellNonPsaSorted = nonPsa
      .filter((l) => l.price_type === "Sell")
      .sort(sortSell);
    const buyPsaSorted = psa
      .filter((l) => l.price_type === "Buy")
      .sort(sortBuy);
    const sellPsaSorted = psa
      .filter((l) => l.price_type === "Sell")
      .sort(sortSell);

    return {
      buyNonPsa: buyNonPsaSorted.map(toDetail),
      sellNonPsa: sellNonPsaSorted.map(toDetail),
      buyPsa: buyPsaSorted.map(toDetail),
      sellPsa: sellPsaSorted.map(toDetail),
    };
  }, [rawListings, rateMap, locationMap, conditionsMap, selectedTiers]);

  // H1: "how many do I already have" - the on-hand total plus a
  // per-condition/grade breakdown. Rendered always: in-shop, an explicit
  // "none owned" beats silence.
  const ownedSummary = useMemo(() => {
    const byLabel = new Map<string, number>();
    let total = 0;
    for (const row of heldRows) {
      const qty = Number(row.qty_on_hand);
      if (qty <= 0) continue;
      total += qty;
      let label: string;
      if ((row.psa_grade ?? 0) > 0) {
        label = `PSA ${row.psa_grade}`;
      } else {
        const tier =
          row.condition_id != null ? conditionsMap.get(row.condition_id) : undefined;
        label = tier != null ? `Tier ${tier}` : t("inventory.raw");
      }
      byLabel.set(label, (byLabel.get(label) ?? 0) + qty);
    }
    const breakdown = [...byLabel.entries()]
      .map(([label, qty]) => `${qty}× ${label}`)
      .join(" · ");
    return { total, breakdown };
  }, [heldRows, conditionsMap, t]);

  if (!card) return null;

  const { card: def } = card;
  const cardNumber =
    def.card_number && def.card_number !== "UNKNOWN" ? def.card_number : null;
  const misc =
    def.misc_info && def.misc_info !== "UNKNOWN" ? def.misc_info : null;
  const askingNumber = Number(askingPrice);
  const askingPriceUsd = askingPrice.trim() === "" || !Number.isFinite(askingNumber) || askingNumber <= 0
    ? null
    : askingCurrency === "USD" ? askingNumber : askingNumber * (rateMap.get("JPY") ?? 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] min-w-0 overflow-x-hidden overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
            {def.image_url && (
              <img
                src={def.image_url}
                alt={getCardDisplayName(def, language)}
                className="h-44 w-full rounded-md object-contain sm:h-64 sm:w-auto sm:shrink-0"
              />
            )}
            <div className="flex min-w-0 flex-col gap-1">
              <DialogTitle className="text-lg">{getCardDisplayName(def, language)}</DialogTitle>
              {misc && (
                <DialogDescription className="text-xs">
                  {misc}
                </DialogDescription>
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                {cardNumber && (
                  <Badge variant="secondary" className="h-auto px-1.5 py-px">
                    <Hash className="size-3" />
                    {cardNumber}
                  </Badge>
                )}
                <Badge variant="secondary" className="h-auto px-1.5 py-px">
                  <Layers className="size-3" />
                  {def.set_code}
                </Badge>
                {def.rarity && (
                  <Badge variant="secondary" className="h-auto px-1.5 py-px">
                    <Sparkles className="size-3" />
                    {def.rarity}
                  </Badge>
                )}
                {activeGame === "pokemon" && (
                  <label className="ml-1 inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs sm:min-h-0">
                    <Switch
                      size="sm"
                      checked={jpExclusive}
                      disabled={savingJp}
                      onCheckedChange={toggleJpExclusive}
                    />
                    <span className="select-none">🇯🇵 {t("modal.jpExclusive")}</span>
                  </label>
                )}
                <UidChip uid={def.card_uid} />
              </div>
              <div className="mt-1 text-xs">
                {ownedSummary.total + incomingQty > 0 ? (
                  <span className="text-muted-foreground">
                    {t("inventory.owned")} {ownedSummary.total}
                    {ownedSummary.breakdown ? ` (${ownedSummary.breakdown})` : ""}
                    {incomingQty > 0 && (
                      <span className="text-amber-500/90">
                        {" "}{t("inventory.incoming", { n: incomingQty })}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t("inventory.ownedNone")}</span>
                )}
              </div>
              {/* On-demand price refresh for this card (redesign R6). The RPC's
                  verdict renders inline; freshness itself stays on FreshnessChip,
                  which turns green once a queued refresh lands. */}
              <div className="mt-2">
                <RefreshPricesAction cardIds={[Number(def.card_id)]} />
              </div>
            </div>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="grid grid-cols-2 gap-4 pt-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <div className="rounded-md border p-2 space-y-2">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <Skeleton key={j} className="h-4 w-full" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={(v) => {
            const nextTab = String(v) as "non-psa" | "psa";
            setActiveTab(nextTab);
            setSightingGrade(defaultSightingGrade(nextTab));
          }}>
            <div className="flex flex-wrap items-center gap-2">
              <TabsList className="h-11 sm:h-8">
                <TabsTrigger value="non-psa">
                  {t("modal.tabNonPsa")}
                </TabsTrigger>
                {activeGame !== "mtg" && (
                  <TabsTrigger value="psa">{t("modal.tabPsa")}</TabsTrigger>
                )}
              </TabsList>

              {activeTab === "non-psa" && availableTiers.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="outline" className="h-11 sm:h-8" />
                    }
                  >
                    {t("cardBrowser.tierPrefix")}{selectedTiers.sort((a, b) => a - b).join(", ") || t("cardBrowser.tierNone")}
                    <ChevronDown className="ml-1 size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {availableTiers.map((tier) => (
                      <DropdownMenuCheckboxItem
                        key={tier}
                        checked={selectedTiers.includes(tier)}
                        onCheckedChange={(checked) => {
                          setSelectedTiers((prev) =>
                            checked
                              ? [...prev, tier]
                              : prev.filter((t) => t !== tier)
                          );
                        }}
                      >
                        {t("cardBrowser.tierItem", { tier })}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            <TabsContent value="non-psa">
              <ListingTables
                buy={buyNonPsa}
                sell={sellNonPsa}
                conditionHeader={t("modal.condition")}
                t={t}
              />
            </TabsContent>
            {activeGame !== "mtg" && (
              <TabsContent value="psa">
                <ListingTables
                  buy={buyPsa}
                  sell={sellPsa}
                  conditionHeader={t("modal.psaGrade")}
                  t={t}
                />
              </TabsContent>
            )}
          </Tabs>
        )}

        {activeGame === "pokemon" && (
          <GradeEvidencePanel
            card={card}
            cardId={Number(def.card_id)}
            setCode={def.set_code}
            listingFreshnessLabel={t("evidence.listingFreshness")}
            askingPrice={askingPrice}
            askingCurrency={askingCurrency}
            sightingGrade={sightingGrade}
            onSightingGradeChange={setSightingGrade}
            onAskingPriceChange={setAskingPrice}
            onAskingCurrencyChange={setAskingCurrency}
          />
        )}

        {card && (buylists.length > 0 || onRemoveFromBuylist) && (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
            {onRemoveFromBuylist && entryGame && entryId != null && (
              <div className="mr-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <label className="text-sm text-muted-foreground whitespace-nowrap">
                  {t("buyList.targetPrice")}
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    className="h-11 w-28 pl-7 sm:h-8"
                    value={targetPrice}
                    onChange={(e) => setTargetPrice(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveTargetPrice();
                      }
                    }}
                  />
                </div>
                <Button
                  size="icon"
                  className="size-11 sm:size-8"
                  disabled={savingTargetPrice}
                  onClick={saveTargetPrice}
                >
                  {savingTargetPrice ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                </Button>
              </div>
            )}
            {addedTo && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <Check className="size-4" />
                {t("buyList.added", { name: addedTo })}
              </span>
            )}
            {onRemoveFromBuylist && (
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button variant="outline" className="h-11 sm:h-8" />
                  }
                >
                  <Trash2 className="size-4" />
                  {t("buyList.removeFrom")}
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("buyList.removeConfirm")}</AlertDialogTitle>
                    <AlertDialogDescription>{t("buyList.removeConfirmDesc")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("buyList.cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={async () => {
                        await onRemoveFromBuylist();
                        onClose();
                      }}
                    >
                      {t("buyList.remove")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            {buylists.length > 0 && (
              <Popover>
                <PopoverTrigger
                  render={
                    <Button className="h-11 sm:h-8" />
                  }
                >
                  <Plus className="size-4" />
                  {t("buyList.addTo")}
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="end">
                  {buylists.map((bl) => (
                    <button
                      key={bl.buylist_id}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                      onClick={async () => {
                        const psaGrade = activeTab === "psa" ? (card.psaGrade ?? 0) : 0;
                        await addToBuylist(
                          bl.buylist_id,
                          activeGame,
                          card.card.card_id,
                          psaGrade,
                          null
                        );
                        setAddedTo(bl.name);
                        setTimeout(() => setAddedTo(null), 2000);
                      }}
                    >
                      {bl.name}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            )}
            <AddToLotPopover
              mode="single"
              game={activeGame as "pokemon" | "mtg"}
              cardId={card.card.card_id}
              psaGrade={activeTab === "psa" ? (card.psaGrade ?? 0) : 0}
              decisionSnapshot={decisionSnapshot(card, card.signal)}
              entryPriceUsd={askingPriceUsd}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ListingTables({
  buy,
  sell,
  conditionHeader,
  t,
}: {
  buy: DetailListing[];
  sell: DetailListing[];
  conditionHeader: string;
  t: (key: import("@/lib/i18n").TranslationKey) => string;
}) {
  return (
    <div className="min-w-0 grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
      <div className="min-w-0">
        <h3 className="text-sm font-medium mb-2">{t("modal.sell")}</h3>
        <ListingTable
          listings={sell}
          conditionHeader={conditionHeader}
          t={t}
        />
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-medium mb-2">{t("modal.buy")}</h3>
        <ListingTable
          listings={buy}
          conditionHeader={conditionHeader}
          t={t}
        />
      </div>
    </div>
  );
}

export function ListingTable({
  listings,
  conditionHeader,
  t,
}: {
  listings: DetailListing[];
  conditionHeader: string;
  t: (key: import("@/lib/i18n").TranslationKey) => string;
}) {
  const { displayCurrency, convertPrice } = useCurrency();

  if (listings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("modal.noListings")}</p>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("modal.price")}</TableHead>
            <TableHead>{t("modal.location")}</TableHead>
            <TableHead>{conditionHeader}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {listings.map((l, i) => {
            let symbol = l.currencySymbol;
            let price = l.price;
            if (displayCurrency !== "none") {
              const converted = convertPrice(l.price, l.currencyCode);
              symbol = converted.symbol;
              price = converted.price;
            }
            return (
              <TableRow key={i}>
                <TableCell>
                  {symbol}
                  {price}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <FreshnessChip lastUpdated={l.lastUpdated} />
                    {l.listingUrl ? (
                      <a
                        href={l.listingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {l.locationName}
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                    ) : (
                      <span>{l.locationName}</span>
                    )}
                    {l.marketRegion && (
                      <Badge variant="secondary" className="h-auto px-1.5 py-px text-xs">
                        {l.marketRegion}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>{l.conditionLabel}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
