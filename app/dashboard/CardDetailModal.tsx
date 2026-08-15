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
import { useOwnedInventoryVersion, bumpOwnedInventory } from "./owned-inventory";
import { useFxRate, fmtRate } from "@/lib/use-fx-rate";
import GradeEvidencePanel from "./GradeEvidencePanel";
import { decisionSnapshot } from "./DecisionActions";
import { detailOpportunityPayloads, recordOpportunityExposures } from "./opportunity-exposures";
import { formatRoiPct, roiToneClass } from "./theoretical-roi";
import { MarketEvidenceCallout } from "./MarketEvidenceCallout";
import { compareMarketEstimates, type MarketEvidence } from "./market-evidence";

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

// One source lot the held copies came from (a single card instance, broken out
// by where it was bought and that lot's unit cost) + the blended average.
interface SourceRow {
  lineId: number;
  shopLabel: string | null;
  acquiredAt: string | null;
  leg: string;
  tripName: string | null;
  qtyOnHand: number;
  unitCostUsd: number;
  consigned: number;
  // Theoretical exit for THIS lot's remaining copies (null when the line has no
  // exit quote, or on the export leg, which is deliberately unvalued).
  // Gross is the market price; net is gross * netPct, and every ROI uses net.
  exitGrossUsd: number | null;
  exitNetUsd: number | null;
  netPct: number | null;
  roiPct: number | null;
  belowCost: boolean;
}

// One on-the-ground observation the operator logged for this card.
interface ObservationRow {
  sighting_id: number;
  psa_grade: number;
  store_name: string;
  observed_price: number;
  currency: string;
  price_usd: number;
  observed_at: string;
  trip_name: string | null;
}

// One finalized purchase of this card - a real transaction price.
interface PurchaseRow {
  lineId: number;
  unitUsd: number;
  shopLabel: string | null;
  acquiredAt: string | null;
  leg: string;
  tripName: string | null;
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
  const [detailTcgMarketUsd, setDetailTcgMarketUsd] = useState<number | null>(null);
  const [marketEvidenceCardId, setMarketEvidenceCardId] = useState<number | null>(null);
  const [heldRows, setHeldRows] = useState<HeldRow[]>([]);
  const [sourceRows, setSourceRows] = useState<SourceRow[]>([]);
  const [observationRows, setObservationRows] = useState<ObservationRow[]>([]);
  const [purchaseRows, setPurchaseRows] = useState<PurchaseRow[]>([]);
  const [incomingQty, setIncomingQty] = useState(0);
  // Per-line quick sale (record_line_sale): the same lot lines this panel
  // already renders. Pinned to the exact line so COGS comes from that line's
  // own landed basis - no trip-tab detour for a single-card sale.
  const [sellLineId, setSellLineId] = useState<number | null>(null);
  const [sellQty, setSellQty] = useState("1");
  const [sellCcy, setSellCcy] = useState("USD");
  const [sellProceeds, setSellProceeds] = useState("");
  const [sellFx, setSellFx] = useState("1");
  const [sellDate, setSellDate] = useState(() => {
    // Local calendar date, not UTC - toISOString() is yesterday in JST evenings.
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [sellPlatform, setSellPlatform] = useState("");
  const [sellBusy, setSellBusy] = useState(false);
  const [sellError, setSellError] = useState<string | null>(null);
  const [sellDone, setSellDone] = useState<{ marginUsd: number } | null>(null);
  const { rateFor } = useFxRate();
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
    setDetailTcgMarketUsd(null);
    setMarketEvidenceCardId(null);

    async function fetchListings() {
      const supabase = createClient();
      const [{ data: raw, error: rawError }, rates, locations, conditionsData, held, ownedCounts, srcLots, obs, purch, roi, tcgplayer] =
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
          // F2: the source lots the held copies came from - one card instance,
          // broken out by where it was bought + that lot's unit cost. Finalized
          // on-hand only (qty_remaining > 0 is set at finalize).
          supabase
            .from(activeGame === "mtg" ? "mtg_lot_lines" : "pokemon_lot_lines")
            .select("line_id, quantity, qty_remaining, consigned_qty, allocated_cost_usd, acquisition_lots(shop_label, acquired_at, leg, trips(name))")
            .eq("card_id", card!.card.card_id)
            .gt("qty_remaining", 0),
          // Observations the operator logged for this card (Pokemon-only deal
          // subsystem), so the write-only sighting form now has a history above it.
          activeGame === "pokemon"
            ? supabase
                .from("trip_observations_v")
                .select("sighting_id, psa_grade, store_name, observed_price, currency, price_usd, observed_at, trip_name")
                .eq("card_id", card!.card.card_id)
                .order("observed_at", { ascending: false })
            : Promise.resolve({ data: [] as ObservationRow[] }),
          // Every finalized purchase of this card (incl. already-sold) is a real
          // price point: the direct price paid, when, and where. direct_purchase
          // is only set at finalize, so > 0 selects finalized lines.
          supabase
            .from(activeGame === "mtg" ? "mtg_lot_lines" : "pokemon_lot_lines")
            .select("line_id, quantity, direct_purchase_cost_usd, acquisition_lots(shop_label, acquired_at, leg, trips(name))")
            .eq("card_id", card!.card.card_id)
            .gt("direct_purchase_cost_usd", 0),
          // What the on-hand copies could return if sold today, per source lot
          // line - the same figures the lot and leg rollups are built from.
          supabase
            .from("inventory_theoretical_roi_v")
            .select("lot_line_id, qty_on_hand, on_hand_cost_usd, exit_unit_usd, net_pct, exit_net_usd, theoretical_profit_usd, theoretical_roi_pct, days_held, below_cost, priced")
            .eq("game", activeGame)
            .eq("card_id", card!.card.card_id),
          activeGame === "pokemon"
            ? supabase
                .from("pokemon_tcgplayer_market")
                .select("market_usd")
                .eq("card_id", card!.card.card_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
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
      const tcgValue = Number((tcgplayer.data as { market_usd?: number | string } | null)?.market_usd);
      setDetailTcgMarketUsd(Number.isFinite(tcgValue) && tcgValue > 0 ? tcgValue : null);
      setMarketEvidenceCardId(
        activeGame === "pokemon" && !rawError && !tcgplayer.error
          ? Number(card!.card.card_id)
          : null,
      );
      setHeldRows((held.data as HeldRow[] | null) ?? []);
      const roiByLineId = new Map<number, { exit_gross_usd: number | null; exit_net_usd: number | null; net_pct: number | null; theoretical_roi_pct: number | null; below_cost: boolean | null; priced: boolean }>();
      for (const r of ((roi.data as Record<string, unknown>[] | null) ?? [])) {
        const unit = r.exit_unit_usd == null ? null : Number(r.exit_unit_usd);
        roiByLineId.set(Number(r.lot_line_id), {
          exit_gross_usd: unit == null ? null : unit * Number(r.qty_on_hand ?? 0),
          exit_net_usd: r.exit_net_usd == null ? null : Number(r.exit_net_usd),
          net_pct: r.net_pct == null ? null : Number(r.net_pct),
          theoretical_roi_pct: r.theoretical_roi_pct == null ? null : Number(r.theoretical_roi_pct),
          below_cost: r.below_cost as boolean | null,
          priced: r.priced === true,
        });
      }
      setSourceRows(
        (((srcLots.data as Record<string, unknown>[] | null) ?? []).map((r) => {
          const lot = r.acquisition_lots as { shop_label: string | null; acquired_at: string | null; leg: string; trips: { name: string | null } | null } | null;
          const qty = Number(r.quantity) || 1;
          const qtyOnHand = Number(r.qty_remaining) || 0;
          const hit = roiByLineId.get(Number(r.line_id));
          return {
            lineId: Number(r.line_id),
            shopLabel: lot?.shop_label ?? null,
            acquiredAt: lot?.acquired_at ?? null,
            leg: lot?.leg ?? "",
            tripName: lot?.trips?.name ?? null,
            qtyOnHand,
            unitCostUsd: Number(r.allocated_cost_usd) / qty,
            consigned: Math.max(0, Math.min(Number(r.consigned_qty) || 0, qtyOnHand)),
            exitGrossUsd: hit?.priced ? hit.exit_gross_usd : null,
            exitNetUsd: hit?.priced ? hit.exit_net_usd : null,
            netPct: hit?.priced ? hit.net_pct : null,
            roiPct: hit?.priced ? hit.theoretical_roi_pct : null,
            belowCost: hit?.priced === true && hit.below_cost === true,
          } satisfies SourceRow;
        })).sort((a, b) => (a.acquiredAt ?? "").localeCompare(b.acquiredAt ?? "")),
      );
      setObservationRows((obs.data as ObservationRow[] | null) ?? []);
      setPurchaseRows(
        (((purch.data as Record<string, unknown>[] | null) ?? []).map((r) => {
          const lot = r.acquisition_lots as { shop_label: string | null; acquired_at: string | null; leg: string; trips: { name: string | null } | null } | null;
          const qty = Number(r.quantity) || 1;
          return {
            lineId: Number(r.line_id),
            unitUsd: Number(r.direct_purchase_cost_usd) / qty,
            shopLabel: lot?.shop_label ?? null,
            acquiredAt: lot?.acquired_at ?? null,
            leg: lot?.leg ?? "",
            tripName: lot?.trips?.name ?? null,
          } satisfies PurchaseRow;
        })).sort((a, b) => (b.acquiredAt ?? "").localeCompare(a.acquiredAt ?? "")),
      );
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

  const rawMarketEvidence = useMemo<MarketEvidence | null>(() => {
    if (
      activeGame !== "pokemon"
      || !card
      || marketEvidenceCardId !== Number(card.card.card_id)
    ) return null;
    let collectrUsd: number | null = null;
    for (const listing of rawListings) {
      if (
        listing.price_type !== "Sell"
        || Number(listing.psa_grade) !== 0
        || listing.currency !== "USD"
        || locationMap.get(listing.location_id)?.name.toLowerCase() !== "collectr"
      ) continue;
      const value = Number(listing.price);
      if (!Number.isFinite(value) || value <= 0) continue;
      if (collectrUsd == null || value < collectrUsd) collectrUsd = value;
    }
    return compareMarketEstimates(collectrUsd, detailTcgMarketUsd);
  }, [activeGame, card, detailTcgMarketUsd, locationMap, marketEvidenceCardId, rawListings]);

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
              <MarketEvidenceCallout evidence={rawMarketEvidence} />
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

        {/* Your own history with this card - what you hold and where it came
            from, what you paid, what you've seen in shops. Kept BELOW the market
            prices: in a shop the prices are what you opened the card for, and
            this is reference you scroll to. */}
        {sourceRows.length > 0 && (() => {
          const openSell = (s: SourceRow) => {
            setSellError(null);
            setSellDone(null);
            setSellLineId((cur) => (cur === s.lineId ? null : s.lineId));
            setSellQty("1");
            // Import-leg inventory sells in the US (USD); export-leg in Japan (JPY).
            const ccy = s.leg === "export" ? "JPY" : "USD";
            setSellCcy(ccy);
            const r = rateFor(ccy);
            setSellFx(r != null ? fmtRate(r) : "1");
            setSellProceeds("");
            setSellPlatform("");
            const now = new Date();
            setSellDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
          };
          const submitLineSale = async (s: SourceRow) => {
            const qty = Math.floor(Number(sellQty));
            const proceeds = Number(sellProceeds);
            const fx = Number(sellFx) || 1;
            const available = s.qtyOnHand - s.consigned;
            if (!Number.isFinite(qty) || qty < 1 || qty > available) {
              setSellError(t("inventory.sellQtyInvalid", { max: available }));
              return;
            }
            if (!Number.isFinite(proceeds) || proceeds <= 0) {
              setSellError(t("inventory.sellPriceInvalid"));
              return;
            }
            setSellBusy(true);
            setSellError(null);
            const { data, error } = await createClient().rpc("record_line_sale", {
              p_game: activeGame,
              p_lot_line_id: s.lineId,
              p_quantity: qty,
              p_gross_usd: Number((proceeds * fx).toFixed(2)),
              p_fees_usd: 0,
              p_sold_at: sellDate,
              p_orig_currency: sellCcy,
              p_proceeds_orig: proceeds,
              p_fx_rate: fx,
              p_platform_label: sellPlatform.trim() || null,
            });
            setSellBusy(false);
            if (error) {
              setSellError(error.message);
              return;
            }
            const row = (Array.isArray(data) ? data[0] : data) as { margin_usd?: number } | null;
            setSellDone({ marginUsd: Number(row?.margin_usd ?? 0) });
            setSellLineId(null);
            bumpOwnedInventory(); // ownedVersion dependency refetches this panel
          };
          const onHand = sourceRows.reduce((s, r) => s + r.qtyOnHand, 0);
          const basis = sourceRows.reduce((s, r) => s + r.qtyOnHand * r.unitCostUsd, 0);
          const avg = onHand > 0 ? basis / onHand : 0;
          // Card level: only the priced lots go into the ratio, and the footer
          // says how many those were, so a partly-quoted card can't read as a
          // whole-card return.
          const priced = sourceRows.filter((r) => r.exitNetUsd != null);
          const pricedCost = priced.reduce((s, r) => s + r.qtyOnHand * r.unitCostUsd, 0);
          const pricedNet = priced.reduce((s, r) => s + Number(r.exitNetUsd), 0);
          const pricedGross = priced.reduce((s, r) => s + Number(r.exitGrossUsd ?? 0), 0);
          const cardRoiPct = pricedCost > 0 ? ((pricedNet - pricedCost) / pricedCost) * 100 : null;
          // Only print a single rate if every priced lot shares one.
          const rates = new Set(priced.map((r) => r.netPct).filter((p): p is number => p != null));
          const netPct = rates.size === 1 ? [...rates][0] : null;
          return (
            <div className="mt-1 space-y-0.5 rounded-md border bg-muted/30 p-2 text-[11px]">
              <div className="font-medium text-muted-foreground">{t("inventory.ownedFrom")}</div>
              {sourceRows.map((s) => (
                <div key={s.lineId} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-muted-foreground">
                      {s.shopLabel || s.acquiredAt || t("inventory.lot")}
                      {s.leg ? ` · ${s.leg}` : ""}{s.tripName ? ` · ${s.tripName}` : ""}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
                      <span>{s.qtyOnHand}× · ${s.unitCostUsd.toFixed(2)}/ea</span>
                      {s.roiPct != null && (
                        <span className={roiToneClass(s.roiPct)} title={t("roi.theoretical")}>
                          {formatRoiPct(s.roiPct)}
                        </span>
                      )}
                      {s.consigned > 0 && (
                        <span className="text-violet-500/90" title={t("inventory.manageConsignmentInInventory")}>
                          {t("inventory.consignedN", { n: s.consigned })}
                          {" · "}{t("inventory.availableN", { n: s.qtyOnHand - s.consigned })}
                        </span>
                      )}
                      {s.qtyOnHand - s.consigned > 0 && (
                        <Button size="sm" variant={sellLineId === s.lineId ? "secondary" : "outline"}
                          className="h-6 min-h-11 px-2 text-[11px] sm:min-h-6" disabled={sellBusy}
                          onClick={() => openSell(s)}>
                          {t("inventory.sellLine")}
                        </Button>
                      )}
                    </span>
                  </div>
                  {sellLineId === s.lineId && (
                    <div className="flex flex-wrap items-center gap-1.5 rounded border bg-background/60 p-1.5">
                      <Input type="number" inputMode="numeric" value={sellQty} onChange={(e) => setSellQty(e.target.value)}
                        aria-label={t("trips.qty")} title={t("trips.qty")}
                        className="h-11 w-14 min-w-0 sm:h-7" min={1} max={s.qtyOnHand - s.consigned} />
                      <Input type="number" inputMode="decimal" value={sellProceeds} onChange={(e) => setSellProceeds(e.target.value)}
                        placeholder={t("inventory.sellProceeds")} aria-label={t("inventory.sellProceeds")}
                        className="h-11 w-24 min-w-0 flex-1 sm:h-7 sm:flex-none" />
                      <select value={sellCcy} aria-label={t("trips.saleCurrency")}
                        className="h-11 rounded-md border bg-background px-1.5 sm:h-7"
                        onChange={(e) => {
                          const ccy = e.target.value;
                          setSellCcy(ccy);
                          const r = rateFor(ccy);
                          if (r != null) setSellFx(fmtRate(r));
                        }}>
                        <option value="USD">USD</option>
                        <option value="JPY">JPY</option>
                      </select>
                      {sellCcy !== "USD" && (
                        <Input type="number" inputMode="decimal" value={sellFx} onChange={(e) => setSellFx(e.target.value)}
                          aria-label={t("trips.fxRate")} title={t("trips.fxRate")}
                          className="h-11 w-24 min-w-0 sm:h-7" />
                      )}
                      <Input type="date" value={sellDate} onChange={(e) => setSellDate(e.target.value)}
                        aria-label={t("inventory.sellDate")} className="h-11 w-32 min-w-0 sm:h-7" />
                      <Input value={sellPlatform} onChange={(e) => setSellPlatform(e.target.value)}
                        placeholder={t("inventory.sellPlatform")} aria-label={t("inventory.sellPlatform")}
                        className="h-11 w-24 min-w-0 flex-1 sm:h-7 sm:flex-none" />
                      <Button size="sm" className="h-11 px-2 text-[11px] sm:h-7" disabled={sellBusy}
                        onClick={() => void submitLineSale(s)}>
                        {sellBusy ? t("inventory.sellRecording") : t("inventory.sellConfirm")}
                      </Button>
                      {sellError && <span role="alert" className="w-full text-destructive">{sellError}</span>}
                    </div>
                  )}
                </div>
              ))}
              {sellDone && (
                <div role="status" className="text-emerald-600 dark:text-emerald-400">
                  {t("inventory.sellDone", { margin: sellDone.marginUsd.toFixed(2) })}
                </div>
              )}
              <div className="flex items-baseline justify-between gap-2 border-t pt-0.5 font-medium">
                <span>{t("inventory.avgLanded")}</span>
                <span className="tabular-nums">${avg.toFixed(2)}/ea</span>
              </div>
              {cardRoiPct != null && (
                <>
                  <div className="flex items-baseline justify-between gap-2 font-medium">
                    <span className="text-muted-foreground">
                      {t("roi.theoretical")}
                      {priced.length < sourceRows.length && (
                        <span className="font-normal"> · {t("roi.coverage", { priced: priced.length, total: sourceRows.length })}</span>
                      )}
                    </span>
                    <span className="tabular-nums">
                      ${pricedNet.toFixed(2)}{" "}
                      <span className={roiToneClass(cardRoiPct)}>{formatRoiPct(cardRoiPct)}</span>
                    </span>
                  </div>
                  {/* Where that net came from: gross market, and the fee rate. */}
                  <div className="flex items-baseline justify-between gap-2 text-muted-foreground">
                    <span>{t("roi.marketGross", { usd: pricedGross.toFixed(2) })}</span>
                    {netPct != null && <span>{t("roi.netBasis", { pct: Math.round(netPct * 100) })}</span>}
                  </div>
                </>
              )}
            </div>
          );
        })()}
        {purchaseRows.length > 0 && (
          <div className="mt-1 space-y-0.5 rounded-md border bg-muted/30 p-2 text-[11px]">
            <div className="font-medium text-muted-foreground">{t("inventory.purchases", { n: purchaseRows.length })}</div>
            {purchaseRows.map((p) => (
              <div key={p.lineId} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-muted-foreground">
                  {p.shopLabel || p.acquiredAt || t("inventory.lot")}
                  {p.leg ? ` · ${p.leg}` : ""}
                  {p.acquiredAt ? ` · ${new Date(`${p.acquiredAt}T00:00:00`).toLocaleDateString(language)}` : ""}
                </span>
                <span className="shrink-0 tabular-nums text-emerald-600 dark:text-emerald-400">${p.unitUsd.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
        {observationRows.length > 0 && (
          <div className="mt-1 space-y-0.5 rounded-md border bg-muted/30 p-2 text-[11px]">
            <div className="font-medium text-muted-foreground">{t("inventory.myObservations", { n: observationRows.length })}</div>
            {observationRows.map((o) => (
              <div key={o.sighting_id} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-muted-foreground">
                  {o.store_name}
                  {o.psa_grade > 0 ? ` · PSA ${o.psa_grade}` : ""}
                  {" · "}{new Date(o.observed_at).toLocaleDateString(language)}
                </span>
                <span className="shrink-0 tabular-nums">
                  {o.currency === "JPY" ? "¥" : o.currency === "USD" ? "$" : ""}{Number(o.observed_price).toLocaleString()}
                  {o.currency !== "USD" ? ` · $${Number(o.price_usd).toFixed(2)}` : ""}
                </span>
              </div>
            ))}
          </div>
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
