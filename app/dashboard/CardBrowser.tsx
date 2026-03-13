"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type Game, useGame } from "./GameContext";
import { useHeader } from "./HeaderContext";


const TABLE_MAP: Record<Game, string> = {
  pokemon: "pokemon_card_definitions",
  mtg: "mtg_card_definitions",
};

const LISTINGS_TABLE_MAP: Record<Game, string> = {
  pokemon: "pokemon_market_listings",
  mtg: "mtg_market_listings",
};

interface CardDefinition {
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

interface PriceEntry {
  price: number;
  symbol: string;
  normalizedPrice: number;
}

interface PriceSummary {
  lowestBuy: PriceEntry | null;
  secondLowestBuy: PriceEntry | null;
  highestSell: PriceEntry | null;
  secondHighestSell: PriceEntry | null;
}

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

function formatPriceWithDiff(
  primary: { price: number; symbol: string } | null,
  secondary: { price: number; symbol: string } | null
): string {
  if (!primary) return "—";
  const base = `${primary.symbol}${primary.price}`;
  if (!secondary) return base;
  const diff = Math.abs(secondary.price - primary.price);
  const rounded = Math.round(diff * 100) / 100;
  return `${base} (${primary.symbol}${rounded})`;
}

function computeRoi(prices: PriceSummary | undefined): number | null {
  const buy = prices?.lowestBuy?.normalizedPrice;
  const sell = prices?.highestSell?.normalizedPrice;
  if (buy == null || sell == null || buy === 0) return null;
  return ((sell - buy) / buy) * 100;
}

function formatRoi(prices: PriceSummary): string {
  const roi = computeRoi(prices);
  if (roi === null) return "—";
  return `${Math.round(roi * 100) / 100}%`;
}

type SortKey =
  | "regional_name"
  | "set_code"
  | "card_number"
  | "psa_grade"
  | "lowestBuy"
  | "highestSell"
  | "roi";

type SortDir = "asc" | "desc";

const BASE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "regional_name", label: "Name" },
  { key: "card_number", label: "Card Number" },
  { key: "set_code", label: "Set Code" },
];

const PRICE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "lowestBuy", label: "Lowest Buy" },
  { key: "highestSell", label: "Highest Sell" },
  { key: "roi", label: "ROI" },
];

const PSA_COLUMN = { key: "psa_grade" as SortKey, label: "PSA" };

interface DisplayRow {
  key: string;
  card: CardDefinition;
  psaGrade?: number;
}

export default function CardBrowser() {
  const { activeGame, psaMode, setPsaMode } = useGame();
  const { setHeaderActions } = useHeader();
  const [search, setSearch] = useState("");
  const [searchCardNumber, setSearchCardNumber] = useState("");
  const [searchSetCode, setSearchSetCode] = useState("");
  const [displayRows, setDisplayRows] = useState<DisplayRow[]>([]);
  const [priceSummaries, setPriceSummaries] = useState<
    Map<string, PriceSummary>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("roi");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const columns = useMemo(
    () =>
      psaMode === "psa"
        ? [...BASE_COLUMNS, PSA_COLUMN, ...PRICE_COLUMNS]
        : [...BASE_COLUMNS, ...PRICE_COLUMNS],
    [psaMode]
  );

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sortedRows = useMemo(() => {
    const priceKeys = ["lowestBuy", "highestSell"] as const;

    return [...displayRows].sort((a, b) => {
      let cmp = 0;

      if (sortKey === "roi") {
        const ra = computeRoi(priceSummaries.get(a.key));
        const rb = computeRoi(priceSummaries.get(b.key));
        if (ra === null && rb === null) cmp = 0;
        else if (ra === null) cmp = 1;
        else if (rb === null) cmp = -1;
        else cmp = ra - rb;
      } else if (sortKey === "psa_grade") {
        const ga = a.psaGrade ?? 0;
        const gb = b.psaGrade ?? 0;
        cmp = ga - gb;
      } else if (priceKeys.includes(sortKey as (typeof priceKeys)[number])) {
        const pa =
          priceSummaries.get(a.key)?.[
            sortKey as (typeof priceKeys)[number]
          ]?.normalizedPrice ?? null;
        const pb =
          priceSummaries.get(b.key)?.[
            sortKey as (typeof priceKeys)[number]
          ]?.normalizedPrice ?? null;
        if (pa === null && pb === null) cmp = 0;
        else if (pa === null) cmp = 1;
        else if (pb === null) cmp = -1;
        else cmp = pa - pb;
      } else {
        const va = (a.card[sortKey as keyof CardDefinition] as string | null) ?? "";
        const vb = (b.card[sortKey as keyof CardDefinition] as string | null) ?? "";
        cmp = va.localeCompare(vb);
      }

      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [displayRows, priceSummaries, sortKey, sortDir]);

  useEffect(() => {
    setSearch("");
    setSearchCardNumber("");
    setSearchSetCode("");
  }, [activeGame]);

  useEffect(() => {
    setHeaderActions(
      <>
        <Switch
          id="psa-toggle"
          checked={psaMode === "psa"}
          onCheckedChange={(checked: boolean) =>
            setPsaMode(checked ? "psa" : "non-psa")
          }
        />
        <label htmlFor="psa-toggle" className="text-sm text-muted-foreground">
          PSA
        </label>
      </>
    );
    return () => setHeaderActions(null);
  }, [psaMode, setPsaMode, setHeaderActions]);

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

    if (cardsError) {
      setError(cardsError.message);
      setDisplayRows([]);
      setPriceSummaries(new Map());
      setLoading(false);
      return;
    }

    const cardIds = (cards ?? []).map((c) => c.card_id);
    if (cardIds.length === 0) {
      setDisplayRows([]);
      setPriceSummaries(new Map());
      setLoading(false);
      return;
    }

    let listingsQuery = supabase
      .from(LISTINGS_TABLE_MAP[activeGame])
      .select("card_id, price_type, price, currency, psa_grade, currencies(symbol)")
      .in("card_id", cardIds);

    if (psaMode === "non-psa") {
      listingsQuery = listingsQuery.eq("psa_grade", 0);
    } else {
      listingsQuery = listingsQuery.gt("psa_grade", 0);
    }

    const [{ data: listings }, { data: rates }] = await Promise.all([
      listingsQuery,
      supabase
        .from("exchange_rates")
        .select("from_currency, to_currency, rate")
        .eq("to_currency", "USD"),
    ]);

    const rateMap = new Map<string, number>();
    for (const r of rates ?? []) {
      rateMap.set(r.from_currency, r.rate);
    }

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

    if (psaMode === "non-psa") {
      const rows: DisplayRow[] = (cards ?? []).map((c) => ({
        key: String(c.card_id),
        card: c,
      }));
      setDisplayRows(rows);
      setPriceSummaries(
        computePriceSummaries(normalizedListings, rateMap, (l) =>
          String(l.card_id)
        )
      );
    } else {
      // Group by card_id + psa_grade to create unique rows
      const seen = new Set<string>();
      const rows: DisplayRow[] = [];
      for (const l of normalizedListings) {
        const key = `${l.card_id}:${l.psa_grade}`;
        if (!seen.has(key)) {
          seen.add(key);
          const card = cardMap.get(String(l.card_id));
          if (card) {
            rows.push({ key, card, psaGrade: l.psa_grade });
          }
        }
      }
      setDisplayRows(rows);
      setPriceSummaries(
        computePriceSummaries(normalizedListings, rateMap, (l) =>
          `${l.card_id}:${l.psa_grade}`
        )
      );
    }

    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          type="text"
          placeholder="Name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="basis-1/2"
        />
        <Input
          type="text"
          placeholder="Card Number..."
          value={searchCardNumber}
          onChange={(e) => setSearchCardNumber(e.target.value)}
          className="basis-1/4"
        />
        <Input
          type="text"
          placeholder="Set code..."
          value={searchSetCode}
          onChange={(e) => setSearchSetCode(e.target.value)}
          className="basis-1/4"
        />
      </div>

      {error && (
        <p className="text-destructive text-sm">Error: {error}</p>
      )}

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((col) => (
                  <TableHead
                    key={col.key}
                    className={`cursor-pointer select-none${col.key === "regional_name" ? " w-[40%]" : ""}`}
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}
                    {sortKey === col.key
                      ? sortDir === "asc"
                        ? " \u25B2"
                        : " \u25BC"
                      : ""}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-center">
                    No results found
                  </TableCell>
                </TableRow>
              ) : (
                sortedRows.map((row) => {
                  const prices = priceSummaries.get(row.key) ?? {
                    lowestBuy: null,
                    secondLowestBuy: null,
                    highestSell: null,
                    secondHighestSell: null,
                  };
                  return (
                    <TableRow key={row.key}>
                      <TableCell>
                        {row.card.regional_name}
                        {row.card.misc_info ? ` (${row.card.misc_info})` : ""}
                      </TableCell>
                      <TableCell>{row.card.card_number ?? "—"}</TableCell>
                      <TableCell>{row.card.set_code}</TableCell>
                      {psaMode === "psa" && (
                        <TableCell>{row.psaGrade}</TableCell>
                      )}
                      <TableCell>
                        {formatPriceWithDiff(prices.lowestBuy, prices.secondLowestBuy)}
                      </TableCell>
                      <TableCell>
                        {formatPriceWithDiff(prices.highestSell, prices.secondHighestSell)}
                      </TableCell>
                      <TableCell>{formatRoi(prices)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
