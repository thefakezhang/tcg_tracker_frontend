"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { type Game, type PsaMode } from "./GameContext";

// Sealed entries point at the sealed tables/views for type-exhaustiveness; the
// sealed tab uses its own hook (use-sealed-data.ts), so the card path here never
// runs with "pokemon_sealed".
const CARD_TABLE_MAP: Record<Game, string> = {
  pokemon: "pokemon_card_definitions",
  mtg: "mtg_card_definitions_v",
  pokemon_sealed: "pokemon_sealed_products",
};

const SUMMARIES_TABLE_MAP: Record<Game, string> = {
  pokemon: "pokemon_price_summaries",
  mtg: "mtg_price_summaries",
  pokemon_sealed: "pokemon_sealed_summaries_v",
};

export const LISTINGS_TABLE_MAP: Record<Game, string> = {
  pokemon: "pokemon_market_listings",
  mtg: "mtg_market_listings",
  pokemon_sealed: "pokemon_sealed_market_listings",
};

export interface CardDefinition {
  card_id: string;
  regional_name: string;
  english_name?: string | null;
  set_code: string;
  card_number: string | null;
  misc_info: string | null;
  image_url: string | null;
  rarity?: string | null; // Pokémon only (from TCGPlayer); undefined for MTG
  is_japan_exclusive?: boolean | null; // Pokémon only; manual curator flag (093)
  // MTG-only (from mtg_card_definitions_v); undefined for Pokémon.
  is_foil?: boolean | null;
  foil_type?: string | null;
  language?: string | null;
}

export function getCardDisplayName(
  card: Pick<CardDefinition, "regional_name" | "english_name">,
  language: "en" | "ja"
): string {
  if (language === "en" && card.english_name) return card.english_name;
  return card.regional_name;
}

// The variant tag worth showing — null for the plain base printing (misc_info is
// 'UNKNOWN' for ~69% of cards, which we treat as "no variant").
export function cardVariant(miscInfo?: string | null): string | null {
  const v = (miscInfo ?? "").trim();
  return v && v.toUpperCase() !== "UNKNOWN" ? v : null;
}

// Muted subtitle for a card: "SET 123/456 · <variant>" (variant omitted when base).
export function cardMeta(setCode?: string | null, cardNumber?: string | null, miscInfo?: string | null): string {
  const setNum = [setCode, cardNumber].filter(Boolean).join(" ");
  return [setNum, cardVariant(miscInfo)].filter(Boolean).join(" · ");
}

export const POKEMON_CARD_DEF_COLS =
  "card_id, regional_name, english_name, set_code, card_number, misc_info, image_url, rarity, is_japan_exclusive";
export const MTG_CARD_DEF_COLS =
  "card_id, regional_name, set_code, card_number, misc_info, image_url, is_foil, foil_type, language";

export function cardDefCols(game: Game): string {
  return game === "pokemon" ? POKEMON_CARD_DEF_COLS : MTG_CARD_DEF_COLS;
}

// "Promotional cards" in the catalog (Pokémon): any set_code ending in -P (the
// Japanese promo convention — covers SM-P, S-P, XY-P, BW-P, DP-P, …), the
// non--P promo set codes, or a TCGPlayer rarity tag of "Promo". The set was
// derived authoritatively by mapping TCGPlayer's promo-named source sets to
// their catalog set_codes. PostgREST or-filter on the embedded card-def table.
const POKEMON_PROMO_OR =
  "set_code.ilike.%-P,set_code.in.(P,PLAY,PPP,OLD-CPC,OLD-UPC,OLD-JCDP),rarity.eq.Promo";

export interface MarketListing {
  card_id: number;
  price_type: "Buy" | "Sell";
  price: number;
  currency: string;
  currency_symbol: string;
  psa_grade: number;
  condition: number | null;
  location_id: number;
  listing_url: string | null;
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

// Debounce free-text inputs so we fire one query after typing settles, not one
// per keystroke (each query is an ilike over a joined table — expensive).
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function useCardData(options: {
  activeGame: Game;
  psaMode: PsaMode;
  search: string;
  searchCardNumber: string;
  searchSetCode: string;
  selectedTier: number;
  sellRegion: RegionFilter;
  rarity: string | null;
  promosOnly: boolean;
  jpExclusiveOnly: boolean;
  minBuyPrice: number | null;
  minSellPrice: number | null;
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
    rarity,
    promosOnly,
    jpExclusiveOnly,
    minBuyPrice,
    minSellPrice,
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

  const dSearch = useDebouncedValue(search, 300);
  const dCardNumber = useDebouncedValue(searchCardNumber, 300);
  const dSetCode = useDebouncedValue(searchSetCode, 300);

  useEffect(() => {
    const supabase = createClient();
    fetchConditionsCache(supabase).then((c) => setAvailableTiers(c.tiers));
  }, []);

  useEffect(() => {
    fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGame, psaMode, dSearch, dCardNumber, dSetCode, selectedTier, sellRegion, rarity, promosOnly, jpExclusiveOnly, minBuyPrice, minSellPrice, roiFloor, roiCeiling, sortColumn, sortAsc, page, pageSize]);

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
    const selectStr = `*, ${cardDefTable}!inner(${cardDefCols(activeGame)})`;

    let query = supabase
      .from(summariesTable)
      .select(selectStr, { count: "estimated" });

    // Filter by tier/psa
    if (psaMode === "non-psa") {
      query = query.eq("tier", selectedTier).eq("psa_grade", 0);
    } else {
      query = query.eq("tier", -1).gt("psa_grade", 0);
    }

    // Search filters on joined card_definitions (debounced values)
    const s = dSearch.trim();
    const cn = dCardNumber.trim();
    const sc = dSetCode.trim();
    if (s) {
      // Escape characters that have meaning in PostgREST or-filters
      const safe = s.replace(/[,()*]/g, " ");
      const orFilter =
        activeGame === "pokemon"
          ? `regional_name.ilike.%${safe}%,english_name.ilike.%${safe}%,misc_info.ilike.%${safe}%`
          : `regional_name.ilike.%${safe}%,misc_info.ilike.%${safe}%,foil_type.ilike.%${safe}%,language.ilike.%${safe}%`;
      query = query.or(orFilter, { referencedTable: cardDefTable });
    }
    if (cn) query = query.ilike(`${cardDefTable}.card_number`, `%${cn}%`);
    if (sc) query = query.ilike(`${cardDefTable}.set_code`, `%${sc}%`);
    if (rarity) query = query.eq(`${cardDefTable}.rarity`, rarity);
    if (promosOnly && activeGame === "pokemon") {
      query = query.or(POKEMON_PROMO_OR, { referencedTable: cardDefTable });
    }
    if (jpExclusiveOnly && activeGame === "pokemon") {
      query = query.eq(`${cardDefTable}.is_japan_exclusive`, true);
    }

    // Region filter on sell side (displayed as "Lowest Buy")
    if (sellRegion !== "all") {
      query = query.eq("best_sell_region", sellRegion);
    }

    // Min buy price filter (on normalized price for cross-currency comparison)
    if (minBuyPrice != null) query = query.gte("best_sell_normalized", minBuyPrice);
    if (minSellPrice != null) query = query.gte("best_buy_normalized", minSellPrice);

    // ROI range filters
    if (roiFloor != null) query = query.gte("roi", roiFloor);
    if (roiCeiling != null) query = query.lte("roi", roiCeiling);

    // Sorting
    const cardDefSortCols = ["regional_name", "card_number", "set_code", "foil_type", "language"];
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
    query = query.range(from, to).abortSignal(abort.signal);

    let rows: unknown[] | null = null;
    let queryError: { message: string } | null = null;
    let count: number | null = null;
    try {
      const res = await query;
      rows = res.data;
      queryError = res.error;
      count = res.count;
    } catch (e) {
      // Superseded by a newer query (abort) — drop silently.
      if (abort.signal.aborted) return;
      queryError = { message: String(e) };
    }

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
