"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { type Game, type PsaMode } from "./GameContext";

const TABLE_MAP: Record<Game, string> = {
  pokemon: "pokemon_card_definitions",
  mtg: "mtg_card_definitions",
};

export const LISTINGS_TABLE_MAP: Record<Game, string> = {
  pokemon: "pokemon_market_listings",
  mtg: "mtg_market_listings",
};

export interface CardDefinition {
  card_id: string;
  regional_name: string;
  set_code: string;
  card_number: string | null;
  misc_info: string | null;
  image_url: string | null;
}

export interface MarketListing {
  card_id: number;
  price_type: "Buy" | "Sell";
  price: number;
  currency: string;
  currency_symbol: string;
  psa_grade: number;
  condition: number | null;
  location_id: number;
}

interface RpcPriceSummaryRow {
  card_id: number;
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
}

export interface PriceEntry {
  price: number;
  symbol: string;
  currencyCode: string;
  normalizedPrice: number;
  locationName: string;
  marketRegion: string | null;
}

export interface PriceSummary {
  highestBuy: PriceEntry | null;
  lowestSell: PriceEntry | null;
}

export interface CardRowData {
  key: string;
  card: CardDefinition;
  psaGrade?: number;
  prices: PriceSummary;
  roi: number | null;
}

const EMPTY_PRICES: PriceSummary = {
  highestBuy: null,
  lowestSell: null,
};

function rpcRowToPriceSummary(row: RpcPriceSummaryRow): PriceSummary {
  const highestBuy: PriceEntry | null =
    row.best_buy_price != null
      ? {
          price: row.best_buy_price,
          symbol: row.best_buy_symbol ?? "",
          currencyCode: row.best_buy_currency ?? "",
          normalizedPrice: row.best_buy_normalized ?? 0,
          locationName: row.best_buy_location ?? "",
          marketRegion: row.best_buy_region ?? null,
        }
      : null;

  const lowestSell: PriceEntry | null =
    row.best_sell_price != null
      ? {
          price: row.best_sell_price,
          symbol: row.best_sell_symbol ?? "",
          currencyCode: row.best_sell_currency ?? "",
          normalizedPrice: row.best_sell_normalized ?? 0,
          locationName: row.best_sell_location ?? "",
          marketRegion: row.best_sell_region ?? null,
        }
      : null;

  return { highestBuy, lowestSell };
}

export function computeRoi(prices: PriceSummary): number | null {
  const { highestBuy, lowestSell } = prices;
  if (!highestBuy || !lowestSell) return null;
  // Only show ROI for cross-region arbitrage
  if (highestBuy.marketRegion === lowestSell.marketRegion) return null;
  const sell = lowestSell.normalizedPrice;
  if (sell === 0) return null;
  return ((highestBuy.normalizedPrice - sell) / sell) * 100;
}

// Cache exchange rates per session — they rarely change
let rateMapCache: Map<string, number> | null = null;

// Cache conditions table: condition_id → tier
let conditionsCache: { map: Map<number, number>; tiers: number[] } | null =
  null;

export async function fetchConditionsCache(
  supabase: ReturnType<typeof createClient>
): Promise<{ map: Map<number, number>; tiers: number[] }> {
  if (conditionsCache) return conditionsCache;

  const { data: conditions } = await supabase
    .from("conditions")
    .select("condition_id, tier");

  const map = new Map<number, number>();
  const tierSet = new Set<number>();
  for (const c of conditions ?? []) {
    map.set(c.condition_id, c.tier);
    tierSet.add(c.tier);
  }
  const tiers = [...tierSet].sort((a, b) => a - b);
  conditionsCache = { map, tiers };
  return conditionsCache;
}

export async function fetchRateMap(
  supabase: ReturnType<typeof createClient>
): Promise<Map<string, number>> {
  if (rateMapCache) return rateMapCache;

  const { data: rates } = await supabase
    .from("exchange_rates")
    .select("from_currency, to_currency, rate")
    .eq("to_currency", "USD");

  const map = new Map<string, number>();
  for (const r of rates ?? []) {
    map.set(r.from_currency, r.rate);
  }
  rateMapCache = map;
  return map;
}

export interface LocationInfo {
  name: string;
  marketRegion: string | null;
}

let locationMapCache: Map<number, LocationInfo> | null = null;

export async function fetchLocationMap(
  supabase: ReturnType<typeof createClient>
): Promise<Map<number, LocationInfo>> {
  if (locationMapCache) return locationMapCache;

  const { data: locations } = await supabase
    .from("locations")
    .select("location_id, name, market_region");

  const map = new Map<number, LocationInfo>();
  for (const loc of locations ?? []) {
    map.set(loc.location_id, {
      name: loc.name,
      marketRegion: loc.market_region ?? null,
    });
  }
  locationMapCache = map;
  return map;
}

// Cached card definitions + price summaries per game:psaMode
interface FullCache {
  cards: CardDefinition[];
  summaryRows: RpcPriceSummaryRow[];
  tiers: number[]; // tiers used when this cache was built
}
const fullCache = new Map<string, FullCache>();

function cacheKey(game: Game, psaMode: PsaMode): string {
  return `${game}:${psaMode}`;
}

function filterCards(
  cards: CardDefinition[],
  search: string,
  searchCardNumber: string,
  searchSetCode: string
): CardDefinition[] {
  let result = cards;
  const s = search.trim().toLowerCase();
  const cn = searchCardNumber.trim().toLowerCase();
  const sc = searchSetCode.trim().toLowerCase();
  if (s) result = result.filter((c) => c.regional_name.toLowerCase().includes(s));
  if (cn) result = result.filter((c) => c.card_number?.toLowerCase().includes(cn));
  if (sc) result = result.filter((c) => c.set_code.toLowerCase().includes(sc));
  return result;
}

export function useCardData(options: {
  activeGame: Game;
  psaMode: PsaMode;
  search: string;
  searchCardNumber: string;
  searchSetCode: string;
  selectedTiers: number[];
}): {
  data: CardRowData[];
  loading: boolean;
  error: string | null;
  availableTiers: number[];
  refetch: () => void;
} {
  const {
    activeGame,
    psaMode,
    search,
    searchCardNumber,
    searchSetCode,
    selectedTiers,
  } = options;
  const [data, setData] = useState<CardRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableTiers, setAvailableTiers] = useState<number[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const supabase = createClient();
    fetchConditionsCache(supabase).then((c) => setAvailableTiers(c.tiers));
  }, []);

  // On search/filter changes, rebuild rows from cache (instant)
  useEffect(() => {
    const key = cacheKey(activeGame, psaMode);
    const cached = fullCache.get(key);
    if (cached) {
      setData(buildRows(cached, psaMode, search, searchCardNumber, searchSetCode));
    }
  }, [search, searchCardNumber, searchSetCode]);

  // On game/psaMode change, use cache if available, otherwise fetch
  useEffect(() => {
    const key = cacheKey(activeGame, psaMode);
    const cached = fullCache.get(key);
    if (cached) {
      setData(buildRows(cached, psaMode, search, searchCardNumber, searchSetCode));
      setLoading(false);
    } else {
      fetchAll(false);
    }
  }, [activeGame, psaMode]);

  // On tier change, re-fetch RPC (tiers affect server-side aggregation)
  const tiersRef = useRef(selectedTiers);
  useEffect(() => {
    // Skip the initial mount (handled by game/psaMode effect)
    if (tiersRef.current === selectedTiers) return;
    tiersRef.current = selectedTiers;
    fetchAll(true);
  }, [selectedTiers]);

  async function fetchAll(forceRefresh: boolean) {
    if (abortRef.current) abortRef.current.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setLoading(true);
    setError(null);

    const supabase = createClient();
    const key = cacheKey(activeGame, psaMode);
    const cached = fullCache.get(key);

    // Fetch ALL card definitions (no search filter), paginated to avoid 1000-row limit
    let allCards: CardDefinition[];
    if (cached && !forceRefresh) {
      allCards = cached.cards;
    } else {
      const PAGE_SIZE = 1000;
      const allFetched: CardDefinition[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: page, error: pageError } = await supabase
          .from(TABLE_MAP[activeGame])
          .select("card_id, regional_name, set_code, card_number, misc_info, image_url")
          .range(offset, offset + PAGE_SIZE - 1);

        if (abort.signal.aborted) return;

        if (pageError) {
          setError(pageError.message);
          setData([]);
          setLoading(false);
          return;
        }

        const rows = (page ?? []) as CardDefinition[];
        allFetched.push(...rows);
        hasMore = rows.length === PAGE_SIZE;
        offset += PAGE_SIZE;
      }

      allCards = allFetched;
    }

    if (allCards.length === 0) {
      fullCache.set(key, { cards: allCards, summaryRows: [], tiers: selectedTiers });
      setData([]);
      setLoading(false);
      return;
    }

    // Call RPC for ALL cards (p_card_ids=null means all)
    let summaryRows: RpcPriceSummaryRow[];
    if (cached && !forceRefresh) {
      summaryRows = cached.summaryRows;
    } else {
      const { data: rpcRows, error: rpcError } = await supabase.rpc(
        "get_card_price_summaries",
        {
          p_game: activeGame,
          p_card_ids: null,
          p_psa_mode: psaMode,
          p_tiers: psaMode === "non-psa" && selectedTiers.length > 0 ? selectedTiers : null,
        }
      );

      if (abort.signal.aborted) return;

      if (rpcError) {
        setError(rpcError.message);
        setData([]);
        setLoading(false);
        return;
      }

      summaryRows = (rpcRows ?? []) as RpcPriceSummaryRow[];
    }

    const newCache: FullCache = { cards: allCards, summaryRows, tiers: selectedTiers };
    fullCache.set(key, newCache);

    setData(buildRows(newCache, psaMode, search, searchCardNumber, searchSetCode));
    setLoading(false);
  }

  return { data, loading, error, availableTiers, refetch: () => fetchAll(true) };
}

function buildRows(
  cache: FullCache,
  psaMode: PsaMode,
  search: string,
  searchCardNumber: string,
  searchSetCode: string
): CardRowData[] {
  const filtered = filterCards(cache.cards, search, searchCardNumber, searchSetCode);
  const filteredIds = new Set(filtered.map((c) => c.card_id));

  if (psaMode === "non-psa") {
    const summaryMap = new Map<number, PriceSummary>();
    for (const row of cache.summaryRows) {
      summaryMap.set(row.card_id, rpcRowToPriceSummary(row));
    }
    return filtered.map((c) => {
      const prices = summaryMap.get(Number(c.card_id)) ?? EMPTY_PRICES;
      return {
        key: String(c.card_id),
        card: c,
        prices,
        roi: computeRoi(prices),
      };
    });
  } else {
    const cardMap = new Map(filtered.map((c) => [Number(c.card_id), c]));
    const rows: CardRowData[] = [];
    for (const row of cache.summaryRows) {
      if (!filteredIds.has(String(row.card_id))) continue;
      const card = cardMap.get(row.card_id);
      if (!card) continue;
      const prices = rpcRowToPriceSummary(row);
      rows.push({
        key: `${row.card_id}:${row.psa_grade}`,
        card,
        psaGrade: row.psa_grade,
        prices,
        roi: computeRoi(prices),
      });
    }
    return rows;
  }
}
