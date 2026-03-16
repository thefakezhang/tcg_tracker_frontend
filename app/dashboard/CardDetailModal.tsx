"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Hash, Layers, Plus } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useGame } from "./GameContext";
import { useCurrency } from "./CurrencyContext";
import { useBuyList } from "./BuyListContext";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  type CardRowData,
  type MarketListing,
  type LocationInfo,
  LISTINGS_TABLE_MAP,
  fetchRateMap,
  fetchLocationMap,
  fetchConditionsCache,
} from "./use-card-data";

interface DetailListing {
  price: number;
  currencySymbol: string;
  currencyCode: string;
  locationName: string;
  marketRegion: string | null;
  conditionLabel: string;
}

interface CardDetailModalProps {
  card: CardRowData | null;
  open: boolean;
  onClose: () => void;
  initialPsaMode?: "non-psa" | "psa";
  initialTier?: number;
}

export default function CardDetailModal({
  card,
  open,
  onClose,
  initialPsaMode = "non-psa",
  initialTier = 1,
}: CardDetailModalProps) {
  const { t } = useTranslation();
  const { activeGame } = useGame();
  const { buylists, addToBuylist } = useBuyList();
  const [addedTo, setAddedTo] = useState<string | null>(null);
  const [rawListings, setRawListings] = useState<MarketListing[]>([]);
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

  // Sync modal state with table filters when opening
  useEffect(() => {
    if (open) {
      setActiveTab(initialPsaMode);
      setSelectedTiers([initialTier]);
    }
  }, [open, initialPsaMode, initialTier]);

  useEffect(() => {
    if (!card || !open) return;

    let cancelled = false;
    setLoading(true);

    async function fetchListings() {
      const supabase = createClient();
      const [{ data: raw }, rates, locations, conditionsData] =
        await Promise.all([
          supabase
            .from(LISTINGS_TABLE_MAP[activeGame])
            .select(
              "card_id, price_type, price, currency, psa_grade, condition, location_id, currencies(symbol)"
            )
            .eq("card_id", card!.card.card_id),
          fetchRateMap(supabase),
          fetchLocationMap(supabase),
          fetchConditionsCache(supabase),
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
        })
      );

      setRawListings(listings);
      setRateMap(rates);
      setLocationMap(locations);
      setConditionsMap(conditionsData.map);
      setAvailableTiers(conditionsData.tiers);
      setLoading(false);
    }

    fetchListings();
    return () => {
      cancelled = true;
    };
  }, [card, open, activeGame]);

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

  if (!card) return null;

  const { card: def } = card;
  const cardNumber =
    def.card_number && def.card_number !== "UNKNOWN" ? def.card_number : null;
  const misc =
    def.misc_info && def.misc_info !== "UNKNOWN" ? def.misc_info : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex gap-4">
            {def.image_url && (
              <img
                src={def.image_url}
                alt={def.regional_name}
                className="h-64 w-auto rounded-md object-contain shrink-0"
              />
            )}
            <div className="flex min-w-0 flex-col gap-1">
              <DialogTitle className="text-lg">{def.regional_name}</DialogTitle>
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
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(String(v) as "non-psa" | "psa")}>
            <div className="flex items-center gap-2">
              <TabsList>
                <TabsTrigger value="non-psa">
                  {t("modal.tabNonPsa")}
                </TabsTrigger>
                <TabsTrigger value="psa">{t("modal.tabPsa")}</TabsTrigger>
              </TabsList>

              {activeTab === "non-psa" && availableTiers.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="outline" />
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
            <TabsContent value="psa">
              <ListingTables
                buy={buyPsa}
                sell={sellPsa}
                conditionHeader={t("modal.psaGrade")}
                t={t}
              />
            </TabsContent>
          </Tabs>
        )}

        {card && buylists.length > 0 && (
          <div className="flex items-center justify-end gap-3 border-t pt-4">
            {addedTo && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <Check className="size-4" />
                {t("buyList.added", { name: addedTo })}
              </span>
            )}
            <Popover>
              <PopoverTrigger
                render={
                  <Button />
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
    <div className="grid grid-cols-2 gap-4 pt-2">
      <div>
        <h3 className="text-sm font-medium mb-2">{t("modal.sell")}</h3>
        <ListingTable
          listings={sell}
          conditionHeader={conditionHeader}
          t={t}
        />
      </div>
      <div>
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

function ListingTable({
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
                    <span>{l.locationName}</span>
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
