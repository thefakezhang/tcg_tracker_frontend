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

// Cache RPC price summaries per game:psaMode — only refreshed on explicit user action
const priceSummaryCache = new Map<string, RpcPriceSummaryRow[]>();

function priceCacheKey(game: Game, psaMode: PsaMode): string {
  return `${game}:${psaMode}`;
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
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const supabase = createClient();
    fetchConditionsCache(supabase).then((c) => setAvailableTiers(c.tiers));
  }, []);

  useEffect(() => {
    setLoading(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      fetchCards(false);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [activeGame, psaMode, search, searchCardNumber, searchSetCode, selectedTiers]);

  async function fetchCards(forceRefresh: boolean) {
    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setLoading(true);
    setError(null);

    const supabase = createClient();

    let query = supabase
      .from(TABLE_MAP[activeGame])
      .select("card_id, regional_name, set_code, card_number, misc_info, image_url");

    if (search.trim()) {
      query = query.ilike("regional_name", `%${search.trim()}%`);
    }
    if (searchCardNumber.trim()) {
      query = query.ilike("card_number", `%${searchCardNumber.trim()}%`);
    }
    if (searchSetCode.trim()) {
      query = query.ilike("set_code", `%${searchSetCode.trim()}%`);
    }

    const { data: cards, error: cardsError } = await query;

    if (abort.signal.aborted) return;

    if (cardsError) {
      setError(cardsError.message);
      setData([]);
      setLoading(false);
      return;
    }

    const cardIds = (cards ?? []).map((c) => c.card_id);
    if (cardIds.length === 0) {
      setData([]);
      setLoading(false);
      return;
    }

    const cacheKey = priceCacheKey(activeGame, psaMode);
    let summaryRows: RpcPriceSummaryRow[];

    const cached = priceSummaryCache.get(cacheKey);
    if (cached && !forceRefresh) {
      summaryRows = cached;
    } else {
      const { data: rpcRows, error: rpcError } = await supabase.rpc(
        "get_card_price_summaries",
        {
          p_game: activeGame,
          p_card_ids: cardIds,
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
      priceSummaryCache.set(cacheKey, summaryRows);
    }

    const cardMap = new Map((cards ?? []).map((c) => [c.card_id, c]));

    let rows: CardRowData[];

    if (psaMode === "non-psa") {
      const summaryMap = new Map<number, PriceSummary>();
      for (const row of summaryRows) {
        summaryMap.set(row.card_id, rpcRowToPriceSummary(row));
      }
      rows = (cards ?? []).map((c) => {
        const prices = summaryMap.get(c.card_id) ?? EMPTY_PRICES;
        return {
          key: String(c.card_id),
          card: c,
          prices,
          roi: computeRoi(prices),
        };
      });
    } else {
      rows = [];
      for (const row of summaryRows) {
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
    }

    setData(rows);
    setLoading(false);
  }

  return { data, loading, error, availableTiers, refetch: () => fetchCards(true) };
}
