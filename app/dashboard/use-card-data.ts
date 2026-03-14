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

export interface PriceEntry {
  price: number;
  symbol: string;
  normalizedPrice: number;
  locationName: string;
}

export interface PriceSummary {
  lowestBuy: PriceEntry | null;
  secondLowestBuy: PriceEntry | null;
  highestSell: PriceEntry | null;
  secondHighestSell: PriceEntry | null;
}

export interface CardRowData {
  key: string;
  card: CardDefinition;
  psaGrade?: number;
  prices: PriceSummary;
  roi: number | null;
}

const EMPTY_PRICES: PriceSummary = {
  lowestBuy: null,
  secondLowestBuy: null,
  highestSell: null,
  secondHighestSell: null,
};

function computePriceSummaries(
  listings: MarketListing[],
  rateMap: Map<string, number>,
  locationMap: Map<number, string>,
  keyFn: (l: MarketListing) => string
): Map<string, PriceSummary> {
  const grouped = new Map<string, MarketListing[]>();
  for (const l of listings) {
    const key = keyFn(l);
    const arr = grouped.get(key) ?? [];
    arr.push(l);
    grouped.set(key, arr);
  }

  const result = new Map<string, PriceSummary>();
  for (const [key, cardListings] of grouped) {
    const normalize = (l: MarketListing) =>
      l.price * (rateMap.get(l.currency) ?? 1);

    const buys = cardListings
      .filter((l) => l.price_type === "Buy")
      .sort((a, b) => normalize(a) - normalize(b));

    const sells = cardListings
      .filter((l) => l.price_type === "Sell")
      .sort((a, b) => normalize(b) - normalize(a));

    const toEntry = (l: MarketListing): PriceEntry => ({
      price: l.price,
      symbol: l.currency_symbol,
      normalizedPrice: normalize(l),
      locationName: locationMap.get(l.location_id) ?? "",
    });

    result.set(key, {
      lowestBuy: buys[0] ? toEntry(buys[0]) : null,
      secondLowestBuy: buys[1] ? toEntry(buys[1]) : null,
      highestSell: sells[0] ? toEntry(sells[0]) : null,
      secondHighestSell: sells[1] ? toEntry(sells[1]) : null,
    });
  }
  return result;
}

export function computeRoi(prices: PriceSummary): number | null {
  const buy = prices.lowestBuy?.normalizedPrice;
  const sell = prices.highestSell?.normalizedPrice;
  if (buy == null || sell == null || buy === 0) return null;
  return ((sell - buy) / buy) * 100;
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

let locationMapCache: Map<number, string> | null = null;

export async function fetchLocationMap(
  supabase: ReturnType<typeof createClient>
): Promise<Map<number, string>> {
  if (locationMapCache) return locationMapCache;

  const { data: locations } = await supabase
    .from("locations")
    .select("location_id, name");

  const map = new Map<number, string>();
  for (const loc of locations ?? []) {
    map.set(loc.location_id, loc.name);
  }
  locationMapCache = map;
  return map;
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
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      fetchCards();
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [activeGame, psaMode, search, searchCardNumber, searchSetCode, selectedTiers]);

  async function fetchCards() {
    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setLoading(true);
    setError(null);

    const supabase = createClient();

    let query = supabase
      .from(TABLE_MAP[activeGame])
      .select("card_id, regional_name, set_code, card_number, misc_info");

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

    let listingsQuery = supabase
      .from(LISTINGS_TABLE_MAP[activeGame])
      .select(
        "card_id, price_type, price, currency, psa_grade, condition, location_id, currencies(symbol)"
      )
      .in("card_id", cardIds);

    if (psaMode === "non-psa") {
      listingsQuery = listingsQuery.eq("psa_grade", 0);
    } else {
      listingsQuery = listingsQuery.gt("psa_grade", 0);
    }

    const [{ data: listings }, rateMap, conditionsData, locationMap] = await Promise.all([
      listingsQuery,
      fetchRateMap(supabase),
      fetchConditionsCache(supabase),
      fetchLocationMap(supabase),
    ] as const);

    if (abort.signal.aborted) return;

    setAvailableTiers(conditionsData.tiers);

    const normalizedListings: MarketListing[] = (listings ?? []).map(
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

    const cardMap = new Map((cards ?? []).map((c) => [String(c.card_id), c]));

    let rows: CardRowData[];

    if (psaMode === "non-psa") {
      const tierSet = new Set(selectedTiers);
      const filteredListings = normalizedListings.filter((l) => {
        if (l.condition == null) return true;
        const tier = conditionsData.map.get(l.condition);
        return tier != null && tierSet.has(tier);
      });
      const summaries = computePriceSummaries(
        filteredListings,
        rateMap,
        locationMap,
        (l) => String(l.card_id)
      );
      rows = (cards ?? []).map((c) => {
        const prices = summaries.get(String(c.card_id)) ?? EMPTY_PRICES;
        return {
          key: String(c.card_id),
          card: c,
          prices,
          roi: computeRoi(prices),
        };
      });
    } else {
      const summaries = computePriceSummaries(
        normalizedListings,
        rateMap,
        locationMap,
        (l) => `${l.card_id}:${l.psa_grade}`
      );
      const seen = new Set<string>();
      rows = [];
      for (const l of normalizedListings) {
        const key = `${l.card_id}:${l.psa_grade}`;
        if (!seen.has(key)) {
          seen.add(key);
          const card = cardMap.get(String(l.card_id));
          if (card) {
            const prices = summaries.get(key) ?? EMPTY_PRICES;
            rows.push({
              key,
              card,
              psaGrade: l.psa_grade,
              prices,
              roi: computeRoi(prices),
            });
          }
        }
      }
    }

    setData(rows);
    setLoading(false);
  }

  return { data, loading, error, availableTiers };
}
