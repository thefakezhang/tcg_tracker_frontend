"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { type Game, type PsaMode } from "./GameContext";

const TABLE_MAP: Record<Game, string> = {
  pokemon: "pokemon_card_definitions",
  mtg: "mtg_card_definitions",
};

const LISTINGS_TABLE_MAP: Record<Game, string> = {
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

interface MarketListing {
  card_id: number;
  price_type: "Buy" | "Sell";
  price: number;
  currency: string;
  currency_symbol: string;
  psa_grade: number;
}

export interface PriceEntry {
  price: number;
  symbol: string;
  normalizedPrice: number;
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

async function fetchRateMap(
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

export function useCardData(options: {
  activeGame: Game;
  psaMode: PsaMode;
  search: string;
  searchCardNumber: string;
  searchSetCode: string;
}): { data: CardRowData[]; loading: boolean; error: string | null } {
  const { activeGame, psaMode, search, searchCardNumber, searchSetCode } =
    options;
  const [data, setData] = useState<CardRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      fetchCards();
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [activeGame, psaMode, search, searchCardNumber, searchSetCode]);

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
        "card_id, price_type, price, currency, psa_grade, currencies(symbol)"
      )
      .in("card_id", cardIds);

    if (psaMode === "non-psa") {
      listingsQuery = listingsQuery.eq("psa_grade", 0);
    } else {
      listingsQuery = listingsQuery.gt("psa_grade", 0);
    }

    const [{ data: listings }, rateMap] = await Promise.all([
      listingsQuery,
      fetchRateMap(supabase),
    ]);

    if (abort.signal.aborted) return;

    const normalizedListings: MarketListing[] = (listings ?? []).map(
      (l: Record<string, unknown>) => ({
        card_id: l.card_id as number,
        price_type: l.price_type as "Buy" | "Sell",
        price: l.price as number,
        currency: l.currency as string,
        currency_symbol:
          (l.currencies as { symbol: string } | null)?.symbol ?? "",
        psa_grade: l.psa_grade as number,
      })
    );

    const cardMap = new Map((cards ?? []).map((c) => [String(c.card_id), c]));

    let rows: CardRowData[];

    if (psaMode === "non-psa") {
      const summaries = computePriceSummaries(
        normalizedListings,
        rateMap,
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

  return { data, loading, error };
}
