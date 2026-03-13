"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Tab = "pokemon" | "mtg";

const TABLE_MAP: Record<Tab, string> = {
  pokemon: "pokemon_card_definitions",
  mtg: "mtg_card_definitions",
};

const LISTINGS_TABLE_MAP: Record<Tab, string> = {
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
}

interface PriceSummary {
  lowestBuy: { price: number; symbol: string } | null;
  secondLowestBuy: { price: number; symbol: string } | null;
  highestSell: { price: number; symbol: string } | null;
}

function computePriceSummaries(
  listings: MarketListing[],
  rateMap: Map<string, number>
): Map<number, PriceSummary> {
  const grouped = new Map<number, MarketListing[]>();
  for (const l of listings) {
    const arr = grouped.get(l.card_id) ?? [];
    arr.push(l);
    grouped.set(l.card_id, arr);
  }

  const result = new Map<number, PriceSummary>();
  for (const [cardId, cardListings] of grouped) {
    const normalize = (l: MarketListing) =>
      l.price * (rateMap.get(l.currency) ?? 1);

    const buys = cardListings
      .filter((l) => l.price_type === "Buy")
      .sort((a, b) => normalize(a) - normalize(b));

    const sells = cardListings
      .filter((l) => l.price_type === "Sell")
      .sort((a, b) => normalize(b) - normalize(a));

    result.set(cardId, {
      lowestBuy: buys[0]
        ? { price: buys[0].price, symbol: buys[0].currency_symbol }
        : null,
      secondLowestBuy: buys[1]
        ? { price: buys[1].price, symbol: buys[1].currency_symbol }
        : null,
      highestSell: sells[0]
        ? { price: sells[0].price, symbol: sells[0].currency_symbol }
        : null,
    });
  }
  return result;
}

function formatPrice(
  entry: { price: number; symbol: string } | null
): string {
  if (!entry) return "—";
  return `${entry.symbol}${entry.price}`;
}

type SortKey =
  | "regional_name"
  | "set_code"
  | "card_number"
  | "misc_info"
  | "lowestBuy"
  | "secondLowestBuy"
  | "highestSell";

type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "regional_name", label: "Name" },
  { key: "set_code", label: "Set Code" },
  { key: "card_number", label: "Card #" },
  { key: "misc_info", label: "Misc Info" },
  { key: "lowestBuy", label: "Lowest Buy" },
  { key: "secondLowestBuy", label: "2nd Lowest Buy" },
  { key: "highestSell", label: "Highest Sell" },
];

export default function CardBrowser() {
  const [activeTab, setActiveTab] = useState<Tab>("pokemon");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<CardDefinition[]>([]);
  const [priceSummaries, setPriceSummaries] = useState<
    Map<number, PriceSummary>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sortedData = useMemo(() => {
    if (!sortKey) return data;

    const priceKeys = ["lowestBuy", "secondLowestBuy", "highestSell"] as const;

    return [...data].sort((a, b) => {
      let cmp = 0;

      if (priceKeys.includes(sortKey as (typeof priceKeys)[number])) {
        const pa =
          priceSummaries.get(Number(a.card_id))?.[
            sortKey as (typeof priceKeys)[number]
          ]?.price ?? null;
        const pb =
          priceSummaries.get(Number(b.card_id))?.[
            sortKey as (typeof priceKeys)[number]
          ]?.price ?? null;
        if (pa === null && pb === null) cmp = 0;
        else if (pa === null) cmp = 1;
        else if (pb === null) cmp = -1;
        else cmp = pa - pb;
      } else {
        const va = (a[sortKey as keyof CardDefinition] as string | null) ?? "";
        const vb = (b[sortKey as keyof CardDefinition] as string | null) ?? "";
        cmp = va.localeCompare(vb);
      }

      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, priceSummaries, sortKey, sortDir]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      fetchCards();
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [activeTab, search]);

  async function fetchCards() {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    let query = supabase
      .from(TABLE_MAP[activeTab])
      .select("card_id, regional_name, set_code, card_number, misc_info");

    if (search.trim()) {
      query = query.ilike("regional_name", `%${search.trim()}%`);
    }

    const { data: cards, error: cardsError } = await query;

    if (cardsError) {
      setError(cardsError.message);
      setData([]);
      setPriceSummaries(new Map());
      setLoading(false);
      return;
    }

    setData(cards ?? []);

    const cardIds = (cards ?? []).map((c) => c.card_id);
    if (cardIds.length === 0) {
      setPriceSummaries(new Map());
      setLoading(false);
      return;
    }

    const [{ data: listings }, { data: rates }] = await Promise.all([
      supabase
        .from(LISTINGS_TABLE_MAP[activeTab])
        .select("card_id, price_type, price, currency, currencies(symbol)")
        .in("card_id", cardIds),
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
      })
    );

    setPriceSummaries(computePriceSummaries(normalizedListings, rateMap));
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value as Tab);
          setSearch("");
        }}
      >
        <TabsList variant="line">
          <TabsTrigger value="pokemon">Pokemon</TabsTrigger>
          <TabsTrigger value="mtg">MTG</TabsTrigger>
        </TabsList>
      </Tabs>

      <Input
        type="text"
        placeholder="Search by name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

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
                {COLUMNS.map((col) => (
                  <TableHead
                    key={col.key}
                    className="cursor-pointer select-none"
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
              {sortedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center">
                    No results found
                  </TableCell>
                </TableRow>
              ) : (
                sortedData.map((card) => {
                  const prices = priceSummaries.get(
                    Number(card.card_id)
                  ) ?? {
                    lowestBuy: null,
                    secondLowestBuy: null,
                    highestSell: null,
                  };
                  return (
                    <TableRow key={card.card_id}>
                      <TableCell>{card.regional_name}</TableCell>
                      <TableCell>{card.set_code}</TableCell>
                      <TableCell>{card.card_number ?? "—"}</TableCell>
                      <TableCell>{card.misc_info ?? "—"}</TableCell>
                      <TableCell>
                        {formatPrice(prices.lowestBuy)}
                      </TableCell>
                      <TableCell>
                        {formatPrice(prices.secondLowestBuy)}
                      </TableCell>
                      <TableCell>
                        {formatPrice(prices.highestSell)}
                      </TableCell>
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
