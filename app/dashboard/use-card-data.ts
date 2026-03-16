"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { type Game, type PsaMode } from "./GameContext";

const CARD_TABLE_MAP: Record<Game, string> = {
  pokemon: "pokemon_card_definitions",
  mtg: "mtg_card_definitions",
};

const SUMMARIES_TABLE_MAP: Record<Game, string> = {
  pokemon: "pokemon_price_summaries",
  mtg: "mtg_price_summaries",
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

// Cache exchange rates per session
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

// Map sort column IDs from the table to summary table columns
const SORT_COLUMN_MAP: Record<string, string> = {
  roi: "roi",
  lowestSell: "best_sell_normalized",
  highestBuy: "best_buy_normalized",
  psa_grade: "psa_grade",
};

interface SummaryRow {
  card_id: number;
  tier: number;
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
  roi: number | null;
  // Joined card definition (keyed by the actual table name at runtime)
  [key: string]: unknown;
}

function summaryRowToCardRow(row: SummaryRow, cardDefKey: string): CardRowData {
  const cardDef = row[cardDefKey] as CardDefinition;

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

  const prices: PriceSummary = { highestBuy, lowestSell };

  return {
    key: row.psa_grade > 0 ? `${row.card_id}:${row.psa_grade}` : String(row.card_id),
    card: cardDef,
    psaGrade: row.psa_grade > 0 ? row.psa_grade : undefined,
    prices,
    roi: row.roi ?? null,
  };
}

export type RegionFilter = "all" | "NA" | "JP";

export function useCardData(options: {
  activeGame: Game;
  psaMode: PsaMode;
  search: string;
  searchCardNumber: string;
  searchSetCode: string;
  selectedTier: number;
  sellRegion: RegionFilter;
  roiFloor: number | null;
  roiCeiling: number | null;
  sortColumn: string;
  sortAsc: boolean;
  page: number;
  pageSize: number;
}): {
  data: CardRowData[];
  loading: boolean;
  error: string | null;
  availableTiers: number[];
  totalCount: number;
  refetch: () => void;
  refresh: () => void;
} {
  const {
    activeGame,
    psaMode,
    search,
    searchCardNumber,
    searchSetCode,
    selectedTier,
    sellRegion,
    roiFloor,
    roiCeiling,
    sortColumn,
    sortAsc,
    page,
    pageSize,
  } = options;
  const [data, setData] = useState<CardRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableTiers, setAvailableTiers] = useState<number[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const supabase = createClient();
    fetchConditionsCache(supabase).then((c) => setAvailableTiers(c.tiers));
  }, []);

  useEffect(() => {
    fetchPage();
  }, [activeGame, psaMode, search, searchCardNumber, searchSetCode, selectedTier, sellRegion, roiFloor, roiCeiling, sortColumn, sortAsc, page, pageSize]);

  async function fetchPage() {
    if (abortRef.current) abortRef.current.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setLoading(true);
    setError(null);

    const supabase = createClient();
    const summariesTable = SUMMARIES_TABLE_MAP[activeGame];
    const cardDefTable = CARD_TABLE_MAP[activeGame];

    // Build query with joined card definitions
    const selectStr = `*, ${cardDefTable}!inner(card_id, regional_name, set_code, card_number, misc_info, image_url)`;

    let query = supabase
      .from(summariesTable)
      .select(selectStr, { count: "exact" });

    // Filter by tier/psa
    if (psaMode === "non-psa") {
      query = query.eq("tier", selectedTier).eq("psa_grade", 0);
    } else {
      query = query.eq("tier", -1).gt("psa_grade", 0);
    }

    // Search filters on joined card_definitions
    const s = search.trim();
    const cn = searchCardNumber.trim();
    const sc = searchSetCode.trim();
    if (s) query = query.or(`regional_name.ilike.%${s}%,misc_info.ilike.%${s}%`, { referencedTable: cardDefTable });
    if (cn) query = query.ilike(`${cardDefTable}.card_number`, `%${cn}%`);
    if (sc) query = query.ilike(`${cardDefTable}.set_code`, `%${sc}%`);

    // Region filter on sell side (displayed as "Lowest Buy")
    if (sellRegion !== "all") {
      query = query.eq("best_sell_region", sellRegion);
    }

    // ROI range filters
    if (roiFloor != null) query = query.gte("roi", roiFloor);
    if (roiCeiling != null) query = query.lte("roi", roiCeiling);

    // Sorting
    const cardDefSortCols = ["regional_name", "card_number", "set_code"];
    if (cardDefSortCols.includes(sortColumn)) {
      query = query.order(sortColumn, {
        ascending: sortAsc,
        nullsFirst: false,
        referencedTable: cardDefTable,
      });
    } else {
      const dbCol = SORT_COLUMN_MAP[sortColumn] || sortColumn;
      query = query.order(dbCol, { ascending: sortAsc, nullsFirst: false });
    }

    // Pagination
    const from = page * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data: rows, error: queryError, count } = await query;

    if (abort.signal.aborted) return;

    if (queryError) {
      setError(queryError.message);
      setData([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    const cardRows = ((rows ?? []) as unknown as SummaryRow[]).map((row) =>
      summaryRowToCardRow(row, cardDefTable)
    );

    setData(cardRows);
    setTotalCount(count ?? 0);
    setLoading(false);
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/aggregate-prices", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Refresh failed (${res.status})`);
        setLoading(false);
        return;
      }
    } catch (err) {
      setError(String(err));
      setLoading(false);
      return;
    }
    await fetchPage();
  }

  return {
    data,
    loading,
    error,
    availableTiers,
    totalCount,
    refetch: () => fetchPage(),
    refresh,
  };
}
