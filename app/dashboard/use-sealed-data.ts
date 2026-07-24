"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { externalIdMatches, smartSearchFilters } from "@/lib/card-search";
import { type TranslationKey } from "@/lib/i18n";
import {
  type CardRowData,
  type PriceEntry,
  type RegionFilter,
  useDebouncedValue,
} from "./use-card-data";

export const SEALED_SUMMARY_VIEW = "pokemon_sealed_summaries_v";
export const SEALED_SUMMARY_BEST_VIEW = "pokemon_sealed_summaries_best_v";

export type SealedCondition = "best" | "shrink" | "no_shrink" | "standard";
export type SealedEdition = "best" | "1ed" | "unlimited" | "standard";

export const SEALED_CONDITIONS: SealedCondition[] = [
  "best",
  "shrink",
  "no_shrink",
  "standard",
];
export const SEALED_EDITIONS: SealedEdition[] = [
  "best",
  "1ed",
  "unlimited",
  "standard",
];

// Sealed rows reuse CardRowData (so the generic table/grid/PriceCell work) but
// carry the extra sealed dimensions for filtering, badges, and the modal.
export interface SealedRowData extends CardRowData {
  productType: string;
  sealedCondition: string;
  variantEdition: string;
  language: string;
}

// A flat row from pokemon_sealed_summaries_v (column names already aliased to
// the card shape by the view).
export interface SealedSummaryRow {
  card_id: number;
  regional_name: string;
  english_name: string | null;
  set_code: string;
  card_number: string | null;
  misc_info: string | null;
  image_url: string | null;
  product_type: string;
  language: string;
  sealed_condition: string;
  variant_edition: string;
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
  product_uid?: string | null; // appended by 000216 (H3)
}

function toPrice(row: SealedSummaryRow, side: "buy" | "sell"): PriceEntry | null {
  const price = side === "buy" ? row.best_buy_price : row.best_sell_price;
  if (price == null) return null;
  return {
    price,
    symbol: (side === "buy" ? row.best_buy_symbol : row.best_sell_symbol) ?? "",
    currencyCode:
      (side === "buy" ? row.best_buy_currency : row.best_sell_currency) ?? "",
    normalizedPrice:
      (side === "buy" ? row.best_buy_normalized : row.best_sell_normalized) ?? 0,
    locationName:
      (side === "buy" ? row.best_buy_location : row.best_sell_location) ?? "",
    marketRegion:
      (side === "buy" ? row.best_buy_region : row.best_sell_region) ?? null,
  };
}

export function sealedRowToCardRow(row: SealedSummaryRow): SealedRowData {
  return {
    key: `${row.card_id}:${row.sealed_condition}:${row.variant_edition}`,
    card: {
      card_id: String(row.card_id),
      card_uid: row.product_uid ?? null,
      regional_name: row.regional_name,
      english_name: row.english_name,
      set_code: row.set_code,
      card_number: null,
      misc_info: row.misc_info,
      image_url: row.image_url,
    },
    prices: {
      highestBuy: toPrice(row, "buy"),
      lowestSell: toPrice(row, "sell"),
    },
    roi: row.roi ?? null,
    productType: row.product_type,
    sealedCondition: row.sealed_condition,
    variantEdition: row.variant_edition,
    language: row.language,
  };
}

// --- Display label helpers (shared by browser, columns, and modal) ---

const CONDITION_LABEL_KEYS: Record<string, TranslationKey> = {
  shrink: "sealedBrowser.conditionShrink",
  no_shrink: "sealedBrowser.conditionNoShrink",
  standard: "sealedBrowser.conditionStandard",
};
const EDITION_LABEL_KEYS: Record<string, TranslationKey> = {
  "1ed": "sealedBrowser.edition1ed",
  unlimited: "sealedBrowser.editionUnlimited",
  standard: "sealedBrowser.editionStandard",
};
const PRODUCT_TYPE_LABEL_KEYS: Record<string, TranslationKey> = {
  booster_box: "sealed.type.booster_box",
  booster_bundle: "sealed.type.booster_bundle",
  booster_pack: "sealed.type.booster_pack",
  build_battle_box: "sealed.type.build_battle_box",
  pokecenter_exclusive: "sealed.type.pokecenter_exclusive",
  premium_collection: "sealed.type.premium_collection",
  special_collection: "sealed.type.special_collection",
  other: "sealed.type.other",
};

type TFn = (key: TranslationKey) => string;

export function conditionLabel(t: TFn, value: string): string {
  const key = CONDITION_LABEL_KEYS[value];
  return key ? t(key) : value;
}
export function editionLabel(t: TFn, value: string): string {
  const key = EDITION_LABEL_KEYS[value];
  return key ? t(key) : value;
}
export function productTypeLabel(t: TFn, value: string): string {
  const key = PRODUCT_TYPE_LABEL_KEYS[value];
  return key ? t(key) : value.replace(/_/g, " ");
}

const SORT_COLUMN_MAP: Record<string, string> = {
  roi: "roi",
  lowestSell: "best_sell_normalized",
  highestBuy: "best_buy_normalized",
  productType: "product_type",
  condition: "sealed_condition",
  edition: "variant_edition",
};

export function useSealedData(options: {
  search: string;
  searchSetCode: string;
  condition: SealedCondition;
  edition: SealedEdition;
  sellRegion: RegionFilter;
  minBuyPrice: number | null;
  minSellPrice: number | null;
  roiFloor: number | null;
  roiCeiling: number | null;
  sortColumn: string;
  sortAsc: boolean;
  page: number;
  pageSize: number;
}): {
  data: SealedRowData[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  refetch: () => void;
  refresh: () => void;
} {
  const {
    search,
    searchSetCode,
    condition,
    edition,
    sellRegion,
    minBuyPrice,
    minSellPrice,
    roiFloor,
    roiCeiling,
    sortColumn,
    sortAsc,
    page,
    pageSize,
  } = options;
  const [data, setData] = useState<SealedRowData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const dSearch = useDebouncedValue(search, 300);
  const dSetCode = useDebouncedValue(searchSetCode, 300);

  useEffect(() => {
    fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dSearch,
    dSetCode,
    condition,
    edition,
    sellRegion,
    minBuyPrice,
    minSellPrice,
    roiFloor,
    roiCeiling,
    sortColumn,
    sortAsc,
    page,
    pageSize,
  ]);

  async function fetchPage() {
    if (abortRef.current) abortRef.current.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setLoading(true);
    setError(null);

    const supabase = createClient();
    // Default landing (both "best") collapses to one row per product.
    const target =
      condition === "best" && edition === "best"
        ? SEALED_SUMMARY_BEST_VIEW
        : SEALED_SUMMARY_VIEW;

    let query = supabase.from(target).select("*", { count: "estimated" });

    const s = dSearch.trim();
    const sc = dSetCode.trim();
    if (s) {
      // Shared smart semantics (lib/card-search): pasted product_uid (full or
      // 8-hex prefix) or exact platform id lands the product; otherwise
      // whitespace tokens AND together across the identity columns. The view
      // aliases product_id to card_id, so the external-id gate targets card_id.
      const extIds = await externalIdMatches(
        supabase, "pokemon_sealed_external_identifiers", "product_id", s,
      );
      for (const f of smartSearchFilters(
        s,
        ["regional_name", "english_name", "misc_info", "set_code"],
        "product_uid",
        "card_id",
        extIds,
      )) {
        query = query.or(f);
      }
    }
    if (sc) query = query.ilike("set_code", `%${sc}%`);
    if (condition !== "best") query = query.eq("sealed_condition", condition);
    if (edition !== "best") query = query.eq("variant_edition", edition);
    if (sellRegion !== "all") query = query.eq("best_sell_region", sellRegion);
    if (minBuyPrice != null) query = query.gte("best_sell_normalized", minBuyPrice);
    if (minSellPrice != null) query = query.gte("best_buy_normalized", minSellPrice);
    if (roiFloor != null) query = query.gte("roi", roiFloor);
    if (roiCeiling != null) query = query.lte("roi", roiCeiling);

    const dbCol = SORT_COLUMN_MAP[sortColumn] || sortColumn;
    query = query.order(dbCol, { ascending: sortAsc, nullsFirst: false });

    const from = page * pageSize;
    query = query.range(from, from + pageSize - 1).abortSignal(abort.signal);

    let rows: unknown[] | null = null;
    let queryError: { message: string } | null = null;
    let count: number | null = null;
    try {
      const res = await query;
      rows = res.data;
      queryError = res.error;
      count = res.count;
    } catch (e) {
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

    setData(
      ((rows ?? []) as unknown as SealedSummaryRow[]).map(sealedRowToCardRow)
    );
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
    totalCount,
    refetch: () => fetchPage(),
    refresh,
  };
}
