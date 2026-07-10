"use client";

import { useEffect, useState } from "react";
import { Users, Search, Plus, Trash2, X, Star, Bell, History, Filter, LayoutGrid, List, ImageOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { useSupabaseQuery, QueryError } from "./use-query";
import { useDebouncedValue, fetchLocationMap, fetchRateMap, fetchConditionsCache } from "./use-card-data";
import { ListingTable, type DetailListing } from "./CardDetailModal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

// Customers - lightweight CRM (docs/customers_crm.md), Phase 1: rolodex + wishlist.
// Handles is a free-form platform->handle map so a customer can carry any set of
// SNS/contact handles you know them by.

interface Customer {
  customer_id: number;
  name: string;
  handles: Record<string, string> | null;
  location: string | null;
  tags: string[] | null;
  preferences: string | null;
  notes: string | null;
  next_followup_at: string | null;
}
interface WishlistItem {
  wishlist_id: number;
  customer_id: number;
  game: string;
  card_id: number | null;
  product_id: number | null;
  max_price_usd: number | null;
  priority: number;
  status: string;
  notes: string | null;
  label?: string; // resolved client-side
  image_url?: string | null; // resolved client-side (for grid view)
}
// A market-listing row for a wishlisted card, used to show the current per-platform
// prices + source links inline on each saved wishlist item.
interface MarketRow {
  location_id: number;
  price_type: string; // 'Buy' | 'Sell'
  price: number;
  currency: string;
  currency_symbol?: string;
  condition?: number | null;
  psa_grade?: number | null;
  listing_url: string | null;
  last_updated?: string | null;
}
// Stable key so listings line up with their wishlist item across games.
const wishKey = (w: { game: string; card_id: number | null; product_id: number | null }) =>
  `${w.game}:${w.card_id ?? w.product_id}`;
interface WishCriteria {
  criteria_id: number;
  customer_id: number;
  game: string;
  label: string | null;
  rarities: string[] | null;
  set_after_code: string | null;
  set_before_code: string | null;
  set_codes: string[] | null;
  languages: string[] | null;
  is_japan_exclusive: boolean | null;
  is_promo: boolean | null;
  price_min_usd: number | null;
  price_max_usd: number | null;
  priority: number;
  status: string;
  notes: string | null;
}
// A resolved sale attributed to this customer (from sales_ledger_v).
interface PurchaseRow {
  sale_id: number;
  game: string;
  regional_name: string;
  english_name: string | null;
  set_code: string;
  card_number: string | null;
  misc_info: string | null;
  sold_at: string;
  quantity: number;
  gross_usd: number;
  margin_usd: number;
}
function purchaseLabel(p: PurchaseRow): string {
  const name = p.english_name || p.regional_name;
  const set = p.set_code && p.set_code !== "UNKNOWN" ? ` · ${p.set_code}${p.card_number ? ` ${p.card_number}` : ""}` : "";
  return `${name}${set}`;
}

const GAMES = ["pokemon_sealed", "pokemon", "mtg"] as const;
const HANDLE_SUGGESTIONS = ["discord", "instagram", "x", "line", "whatsapp", "phone", "email"];
const selectClass =
  "h-9 w-full rounded-md border bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

async function fetchCustomers(search: string): Promise<Customer[]> {
  const supabase = createClient();
  let q = supabase.from("customers").select("*").order("name").limit(500);
  const s = search.trim();
  if (s) {
    const safe = s.replace(/[%,]/g, " ");
    q = q.or(`name.ilike.%${safe}%,preferences.ilike.%${safe}%,location.ilike.%${safe}%`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Customer[];
}

// searchCatalog finds catalog items for the wishlist picker.
//
// The query is tokenized on whitespace and each token must match SOME column
// (regional_name / english_name / set_code / card_number / misc_info for
// singles; name / set_code for sealed). Tokens AND together, so
// "セビエ SV2P" narrows to Frigibax in set SV2P — impossible with a
// name-only search when hundreds of Pokémon share a name.
//
// Filters out ",%()" from tokens to avoid breaking PostgREST's `.or()`
// parser; other characters (including "/" in card numbers like 024/071)
// pass through fine.
async function searchCatalog(
  game: string,
  query: string,
): Promise<{ id: number; label: string }[]> {
  const supabase = createClient();
  const tokens = query
    .replace(/[%,()]/g, " ")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (tokens.length === 0) return [];

  // Sealed products carry both a native `name` (usually JP) and an optional
  // English translation - search both. Before, the picker only matched `name`
  // + `set_code`, so English queries returned nothing for sealed.
  if (game === "pokemon_sealed") {
    let q = supabase
      .from("pokemon_sealed_products")
      .select("product_id, name, english_name, set_code");
    for (const t of tokens) {
      q = q.or(`name.ilike.%${t}%,english_name.ilike.%${t}%,set_code.ilike.%${t}%`);
    }
    const { data } = await q.limit(8);
    return (data ?? []).map(
      (r: { product_id: number; name: string; english_name: string | null; set_code: string }) => ({
        id: r.product_id,
        label: `${r.english_name || r.name}${
          r.set_code && r.set_code !== "UNKNOWN" ? ` · ${r.set_code}` : ""
        }`,
      }),
    );
  }

  // MTG's flattened view (000128) aliases the English name as `regional_name`
  // and stores the JP translation as `local_name` - there is no `english_name`
  // column at all. Selecting or filtering on it errored the query, so MTG
  // needs its own shape. Pokemon singles keeps the old shape.
  if (game === "mtg") {
    let q = supabase
      .from("mtg_card_definitions_v")
      .select("card_id, regional_name, local_name, set_code, card_number, misc_info");
    for (const t of tokens) {
      q = q.or(
        `regional_name.ilike.%${t}%,local_name.ilike.%${t}%,set_code.ilike.%${t}%,card_number.ilike.%${t}%,misc_info.ilike.%${t}%`,
      );
    }
    const { data } = await q.limit(8);
    return (data ?? []).map(
      (r: {
        card_id: number;
        regional_name: string;
        local_name: string | null;
        set_code: string;
        card_number: string;
        misc_info?: string | null;
      }) => ({
        id: r.card_id,
        label: `${r.regional_name}${r.local_name ? ` / ${r.local_name}` : ""} · ${r.set_code} ${r.card_number}${
          r.misc_info && r.misc_info !== "UNKNOWN" ? ` (${r.misc_info})` : ""
        }`,
      }),
    );
  }

  // Pokemon singles.
  let q = supabase
    .from("pokemon_card_definitions")
    .select("card_id, regional_name, english_name, set_code, card_number, misc_info");
  for (const t of tokens) {
    q = q.or(
      `regional_name.ilike.%${t}%,english_name.ilike.%${t}%,set_code.ilike.%${t}%,card_number.ilike.%${t}%,misc_info.ilike.%${t}%`,
    );
  }
  const { data } = await q.limit(8);
  return (data ?? []).map(
    (r: {
      card_id: number;
      regional_name: string;
      english_name: string | null;
      set_code: string;
      card_number: string;
      misc_info?: string | null;
    }) => ({
      id: r.card_id,
      label: `${r.english_name || r.regional_name} · ${r.set_code} ${r.card_number}${
        r.misc_info && r.misc_info !== "UNKNOWN" ? ` (${r.misc_info})` : ""
      }`,
    }),
  );
}

// resolveWishlist attaches display labels to a customer's wishlist rows.
async function resolveWishlist(items: WishlistItem[]): Promise<WishlistItem[]> {
  if (!items.length) return items;
  const supabase = createClient();
  const meta = new Map<string, { label: string; image_url: string | null }>();
  const singleIds = items.filter((i) => i.card_id).map((i) => i.card_id as number);
  const sealedIds = items.filter((i) => i.product_id).map((i) => i.product_id as number);
  if (singleIds.length) {
    for (const table of ["pokemon_card_definitions", "mtg_card_definitions_v"]) {
      const { data } = await supabase
        .from(table)
        .select("card_id, regional_name, english_name, set_code, card_number, misc_info, image_url")
        .in("card_id", singleIds);
      for (const r of (data ?? []) as {
        card_id: number;
        regional_name: string;
        english_name: string | null;
        set_code: string;
        card_number: string;
        misc_info?: string | null;
        image_url: string | null;
      }[]) {
        meta.set(`c${r.card_id}`, {
          label: `${r.english_name || r.regional_name} · ${r.set_code} ${r.card_number}${
            r.misc_info && r.misc_info !== "UNKNOWN" ? ` (${r.misc_info})` : ""
          }`,
          image_url: r.image_url,
        });
      }
    }
  }
  if (sealedIds.length) {
    const { data } = await supabase
      .from("pokemon_sealed_products")
      .select("product_id, name, set_code, image_url")
      .in("product_id", sealedIds);
    for (const r of (data ?? []) as { product_id: number; name: string; set_code: string; image_url: string | null }[]) {
      meta.set(`p${r.product_id}`, { label: r.name, image_url: r.image_url });
    }
  }
  return items.map((i) => {
    const m = i.card_id ? meta.get(`c${i.card_id}`) : meta.get(`p${i.product_id}`);
    return { ...i, label: m?.label, image_url: m?.image_url ?? null };
  });
}

// Fetch the current market listings (per-platform prices + source links) for the
// cards on a wishlist, keyed by wishKey so each item can show its own breakdown.
async function fetchWishlistListings(items: WishlistItem[]): Promise<Map<string, MarketRow[]>> {
  const supabase = createClient();
  const map = new Map<string, MarketRow[]>();
  const add = (key: string, r: MarketRow) => {
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  };
  const pk = items.filter((i) => i.game === "pokemon" && i.card_id).map((i) => i.card_id as number);
  const mtg = items.filter((i) => i.game === "mtg" && i.card_id).map((i) => i.card_id as number);
  const sealed = items.filter((i) => i.game === "pokemon_sealed" && i.product_id).map((i) => i.product_id as number);
  const toRow = (r: Record<string, unknown>): MarketRow => ({
    location_id: r.location_id as number,
    price_type: r.price_type as string,
    price: r.price as number,
    currency: r.currency as string,
    currency_symbol: (r.currencies as { symbol: string } | null)?.symbol ?? "",
    condition: (r.condition as number | null) ?? null,
    psa_grade: (r.psa_grade as number | null) ?? null,
    listing_url: (r.listing_url as string | null) ?? null,
    last_updated: (r.last_updated as string | null) ?? null,
  });
  const cardCols = "card_id, location_id, price_type, price, currency, condition, psa_grade, listing_url, last_updated, currencies(symbol)";
  if (pk.length) {
    const { data } = await supabase.from("pokemon_market_listings").select(cardCols).in("card_id", pk);
    for (const r of (data ?? []) as Record<string, unknown>[]) add(`pokemon:${r.card_id}`, toRow(r));
  }
  if (mtg.length) {
    const { data } = await supabase.from("mtg_market_listings").select(cardCols).in("card_id", mtg);
    for (const r of (data ?? []) as Record<string, unknown>[]) add(`mtg:${r.card_id}`, toRow(r));
  }
  if (sealed.length) {
    const { data } = await supabase
      .from("pokemon_sealed_market_listings")
      .select("product_id, location_id, price_type, price, currency, listing_url, last_updated, currencies(symbol)")
      .in("product_id", sealed);
    for (const r of (data ?? []) as Record<string, unknown>[]) add(`pokemon_sealed:${r.product_id}`, toRow(r));
  }
  return map;
}

// Turn a raw listing into the DetailListing shape the shared ListingTable renders.
function toDetailListing(
  l: MarketRow,
  locations: Map<number, { name: string; marketRegion: string | null }>,
  conditionsMap: Map<number, number>,
): DetailListing {
  let conditionLabel = "";
  if ((l.psa_grade ?? 0) > 0) conditionLabel = `PSA ${l.psa_grade}`;
  else if (l.condition != null) {
    const tier = conditionsMap.get(l.condition);
    conditionLabel = tier != null ? `Tier ${tier}` : String(l.condition);
  }
  const loc = locations.get(l.location_id);
  return {
    price: l.price,
    currencySymbol: l.currency_symbol ?? "",
    currencyCode: l.currency,
    locationName: loc?.name ?? "",
    marketRegion: loc?.marketRegion ?? null,
    conditionLabel,
    conditionId: l.condition ?? null,
    listingUrl: l.listing_url,
    lastUpdated: l.last_updated ?? null,
  };
}

// Per-item market breakdown rendered the same way the card viewer shows it:
// Sell / Buy tables (price, location + freshness + link, condition), reusing the
// shared ListingTable so the presentation stays identical.
function MarketBreakdown({
  rows, locations, conditionsMap, rateMap, t,
}: {
  rows: MarketRow[] | undefined;
  locations: Map<number, { name: string; marketRegion: string | null }>;
  conditionsMap: Map<number, number>;
  rateMap: Map<string, number>;
  t: (key: TranslationKey) => string;
}) {
  if (!rows || rows.length === 0) return null;
  const usd = (l: MarketRow) => l.price * (rateMap.get(l.currency) ?? 1);
  const sell = rows.filter((r) => r.price_type === "Sell").sort((a, b) => usd(a) - usd(b)).map((r) => toDetailListing(r, locations, conditionsMap));
  const buy = rows.filter((r) => r.price_type === "Buy").sort((a, b) => usd(b) - usd(a)).map((r) => toDetailListing(r, locations, conditionsMap));
  if (sell.length === 0 && buy.length === 0) return null;
  return (
    <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
      <div>
        <div className="mb-1 text-[11px] font-medium">{t("modal.sell")}</div>
        <ListingTable listings={sell} conditionHeader={t("modal.condition")} t={t} />
      </div>
      <div>
        <div className="mb-1 text-[11px] font-medium">{t("modal.buy")}</div>
        <ListingTable listings={buy} conditionHeader={t("modal.condition")} t={t} />
      </div>
    </div>
  );
}

export default function CustomersView() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 300);
  const { data, error, isLoading, retry } = useSupabaseQuery(["customers", debounced], () =>
    fetchCustomers(debounced),
  );
  const customers = data ?? [];
  const [editing, setEditing] = useState<Customer | null>(null);

  async function createCustomer() {
    const supabase = createClient();
    const { data: created, error: e } = await supabase
      .from("customers")
      .insert({ name: t("customers.newName") })
      .select("*")
      .single();
    if (!e && created) {
      retry();
      setEditing(created as Customer);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Users className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t("customers.title")}</h1>
          {!isLoading && (
            <span className="text-sm text-muted-foreground">
              {t("customers.count").replace("{n}", String(customers.length))}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder={t("customers.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button onClick={createCustomer}>
            <Plus className="size-4" /> {t("customers.new")}
          </Button>
        </div>
      </div>

      {error ? (
        <QueryError onRetry={retry} />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : customers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("customers.empty")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {customers.map((c) => (
            <button
              key={c.customer_id}
              type="button"
              onClick={() => setEditing(c)}
              className="rounded-md border p-3 text-left hover:border-primary hover:bg-muted/40"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{c.name}</span>
                {c.next_followup_at && (
                  <Bell className="size-3.5 shrink-0 text-amber-500" />
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {(c.tags ?? []).map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px]">
                    {tag}
                  </Badge>
                ))}
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {Object.entries(c.handles ?? {})
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ") || c.location || t("customers.noContact")}
              </div>
              {c.preferences && (
                <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.preferences}</div>
              )}
            </button>
          ))}
        </div>
      )}

      <CustomerDetail
        customer={editing}
        open={!!editing}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
        onChanged={retry}
      />
    </div>
  );
}

function CustomerDetail({
  customer,
  open,
  onOpenChange,
  onChanged,
}: {
  customer: Customer | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<Customer | null>(customer);
  const [handleRows, setHandleRows] = useState<[string, string][]>([]);
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [wishlistView, setWishlistView] = useState<"list" | "grid">("list");
  const [listings, setListings] = useState<Map<string, MarketRow[]>>(new Map());
  const [locations, setLocations] = useState<Map<number, { name: string; marketRegion: string | null }>>(new Map());
  const [rateMap, setRateMap] = useState<Map<string, number>>(new Map());
  const [conditionsMap, setConditionsMap] = useState<Map<number, number>>(new Map());
  const [criteria, setCriteria] = useState<WishCriteria[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [inStockIds, setInStockIds] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Platform names + FX rates (cached) for the wishlist market breakdown.
  useEffect(() => {
    const supabase = createClient();
    fetchLocationMap(supabase).then(setLocations).catch(() => {});
    fetchRateMap(supabase).then(setRateMap).catch(() => {});
    fetchConditionsCache(supabase).then((c) => setConditionsMap(c.map)).catch(() => {});
  }, []);

  useEffect(() => {
    setForm(customer);
    setHandleRows(Object.entries(customer?.handles ?? {}));
    setError(null);
    if (customer) {
      const supabase = createClient();
      supabase
        .from("customer_wishlist")
        .select("*")
        .eq("customer_id", customer.customer_id)
        .order("priority")
        .then(({ data }) =>
          resolveWishlist((data ?? []) as WishlistItem[]).then((items) => {
            setWishlist(items);
            fetchWishlistListings(items).then(setListings).catch(() => {});
          }),
        );
      supabase
        .from("sales_ledger_v")
        .select("sale_id, game, regional_name, english_name, set_code, card_number, misc_info, sold_at, quantity, gross_usd, margin_usd")
        .eq("customer_id", customer.customer_id)
        .eq("is_reverted", false)
        .order("sold_at", { ascending: false })
        .limit(100)
        .then(({ data }) => setPurchases((data ?? []) as PurchaseRow[]));
      supabase
        .from("customer_reachout_v")
        .select("wishlist_id")
        .eq("customer_id", customer.customer_id)
        .then(({ data }) =>
          setInStockIds(new Set(((data ?? []) as { wishlist_id: number }[]).map((r) => r.wishlist_id))),
        );
      supabase
        .from("customer_wish_criteria")
        .select("*")
        .eq("customer_id", customer.customer_id)
        .order("priority")
        .then(({ data }) => setCriteria((data ?? []) as WishCriteria[]));
    } else {
      setWishlist([]);
      setListings(new Map());
      setCriteria([]);
      setPurchases([]);
      setInStockIds(new Set());
    }
  }, [customer]);

  async function reloadCriteria() {
    if (!customer) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("customer_wish_criteria")
      .select("*")
      .eq("customer_id", customer.customer_id)
      .order("priority");
    setCriteria((data ?? []) as WishCriteria[]);
  }

  const totalSpent = purchases.reduce((a, p) => a + Number(p.gross_usd), 0);

  if (!form) return null;
  const set = (k: keyof Customer, v: unknown) => setForm({ ...form, [k]: v });

  async function save() {
    if (!form) return;
    setBusy(true);
    setError(null);
    const handles = Object.fromEntries(handleRows.filter(([k, v]) => k.trim() && v.trim()));
    const supabase = createClient();
    const { error: e } = await supabase
      .from("customers")
      .update({
        name: form.name.trim() || "Unnamed",
        handles,
        location: form.location || null,
        tags: form.tags ?? [],
        preferences: form.preferences || null,
        notes: form.notes || null,
        next_followup_at: form.next_followup_at || null,
        updated_at: new Date().toISOString(),
      })
      .eq("customer_id", form.customer_id);
    setBusy(false);
    if (e) {
      setError(e.message);
      return;
    }
    onChanged();
    onOpenChange(false);
  }

  async function remove() {
    if (!form) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.from("customers").delete().eq("customer_id", form.customer_id);
    setBusy(false);
    onChanged();
    onOpenChange(false);
  }

  async function reloadWishlist() {
    if (!form) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("customer_wishlist")
      .select("*")
      .eq("customer_id", form.customer_id)
      .order("priority");
    const items = await resolveWishlist((data ?? []) as WishlistItem[]);
    setWishlist(items);
    fetchWishlistListings(items).then(setListings).catch(() => {});
  }

  async function removeWish(wishlistId: number) {
    const supabase = createClient();
    await supabase.from("customer_wishlist").delete().eq("wishlist_id", wishlistId);
    reloadWishlist();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("customers.detailTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>{t("customers.fName")}</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>

          {/* Handles: any platform -> handle. */}
          <div className="space-y-1">
            <Label>{t("customers.fHandles")}</Label>
            <datalist id="handle-platforms">
              {HANDLE_SUGGESTIONS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <div className="space-y-1">
              {handleRows.map(([k, v], i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    list="handle-platforms"
                    className="w-28"
                    placeholder={t("customers.handlePlatform")}
                    value={k}
                    onChange={(e) => {
                      const next = [...handleRows];
                      next[i] = [e.target.value, v];
                      setHandleRows(next);
                    }}
                  />
                  <Input
                    className="flex-1"
                    placeholder={t("customers.handleValue")}
                    value={v}
                    onChange={(e) => {
                      const next = [...handleRows];
                      next[i] = [k, e.target.value];
                      setHandleRows(next);
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => setHandleRows(handleRows.filter((_, j) => j !== i))}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setHandleRows([...handleRows, ["", ""]])}
              >
                <Plus className="size-3.5" /> {t("customers.addHandle")}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("customers.fLocation")}</Label>
              <Input
                value={form.location ?? ""}
                onChange={(e) => set("location", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t("customers.fFollowup")}</Label>
              <Input
                type="date"
                value={form.next_followup_at ?? ""}
                onChange={(e) => set("next_followup_at", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>{t("customers.fTags")}</Label>
            <Input
              placeholder={t("customers.tagsPlaceholder")}
              value={(form.tags ?? []).join(", ")}
              onChange={(e) =>
                set(
                  "tags",
                  e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
            />
          </div>

          <div className="space-y-1">
            <Label>{t("customers.fPreferences")}</Label>
            <Textarea
              rows={2}
              placeholder={t("customers.prefsPlaceholder")}
              value={form.preferences ?? ""}
              onChange={(e) => set("preferences", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>{t("customers.fNotes")}</Label>
            <Textarea
              rows={2}
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>

          {/* Wishlist */}
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5">
                <Star className="size-3.5" /> {t("customers.wishlist")}
              </Label>
              {wishlist.length > 0 && (
                <div className="flex items-center gap-0.5 rounded-md border p-0.5">
                  <Button type="button" size="icon" className="size-6"
                    variant={wishlistView === "list" ? "secondary" : "ghost"}
                    onClick={() => setWishlistView("list")} aria-label={t("customers.wishlistViewList")}>
                    <List className="size-3.5" />
                  </Button>
                  <Button type="button" size="icon" className="size-6"
                    variant={wishlistView === "grid" ? "secondary" : "ghost"}
                    onClick={() => setWishlistView("grid")} aria-label={t("customers.wishlistViewGrid")}>
                    <LayoutGrid className="size-3.5" />
                  </Button>
                </div>
              )}
            </div>
            {wishlist.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("customers.wishlistEmpty")}</p>
            ) : wishlistView === "list" ? (
              <div className="space-y-1.5">
                {wishlist.map((w) => (
                  <div key={w.wishlist_id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-8 shrink-0 text-xs text-muted-foreground">P{w.priority}</span>
                      <span className="flex-1 truncate">{w.label ?? `#${w.card_id ?? w.product_id}`}</span>
                      {inStockIds.has(w.wishlist_id) && (
                        <Badge variant="secondary" className="shrink-0 text-[10px] text-emerald-600">
                          {t("customers.inStock")}
                        </Badge>
                      )}
                      {w.max_price_usd != null && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          ≤${Number(w.max_price_usd).toFixed(0)}
                        </span>
                      )}
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => removeWish(w.wishlist_id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                    <MarketBreakdown rows={listings.get(wishKey(w))} locations={locations} conditionsMap={conditionsMap} rateMap={rateMap} t={t} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {wishlist.map((w) => (
                  <div key={w.wishlist_id} className="group relative rounded-md border p-1.5">
                    <div className="relative mb-1 flex aspect-[3/4] items-center justify-center overflow-hidden rounded bg-muted">
                      {w.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={w.image_url} alt="" loading="lazy" className="h-full w-full object-contain" />
                      ) : (
                        <ImageOff className="size-6 text-muted-foreground" />
                      )}
                      <span className="absolute left-1 top-1 rounded bg-background/80 px-1 text-[10px] font-medium text-muted-foreground">
                        P{w.priority}
                      </span>
                      {inStockIds.has(w.wishlist_id) && (
                        <Badge variant="secondary" className="absolute bottom-1 left-1 text-[9px] text-emerald-600">
                          {t("customers.inStock")}
                        </Badge>
                      )}
                      <Button type="button" variant="secondary" size="icon"
                        className="absolute right-1 top-1 size-6 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={() => removeWish(w.wishlist_id)}>
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                    <div className="truncate text-xs" title={w.label ?? undefined}>
                      {w.label ?? `#${w.card_id ?? w.product_id}`}
                    </div>
                    {w.max_price_usd != null && (
                      <div className="text-[10px] text-muted-foreground">≤${Number(w.max_price_usd).toFixed(0)}</div>
                    )}
                    <MarketBreakdown rows={listings.get(wishKey(w))} locations={locations} conditionsMap={conditionsMap} rateMap={rateMap} t={t} />
                  </div>
                ))}
              </div>
            )}
            <WishlistAdd customerId={form.customer_id} onAdded={reloadWishlist} />
          </div>

          {/* Criteria-based wishlist: "SARs after M1", "JP exclusive promos",
              etc. Feeds the pre-trip shopping list (customer_shopping_list_v)
              and criterion-matched reach-out (customer_reachout_criteria_v). */}
          <div className="space-y-2 border-t pt-3">
            <Label className="flex items-center gap-1.5">
              <Filter className="size-3.5" /> {t("customers.criteria")}
            </Label>
            <div className="space-y-1">
              {criteria.length === 0 && (
                <p className="text-xs text-muted-foreground">{t("customers.criteriaEmpty")}</p>
              )}
              {criteria.map((c) => (
                <div key={c.criteria_id} className="flex items-start gap-2 text-sm">
                  <span className="w-8 shrink-0 text-xs text-muted-foreground">P{c.priority}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{c.label || t("customers.criteriaUnlabeled")}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[
                        c.rarities?.length ? c.rarities.join(", ") : null,
                        c.set_after_code && c.set_before_code
                          ? `${c.set_after_code}..${c.set_before_code}`
                          : c.set_after_code
                            ? `after ${c.set_after_code}`
                            : c.set_before_code
                              ? `before ${c.set_before_code}`
                              : null,
                        c.set_codes?.length ? `sets ${c.set_codes.join(",")}` : null,
                        c.languages?.length ? c.languages.join("/") : null,
                        c.is_japan_exclusive ? "JP-only" : null,
                        c.is_promo ? "promo" : null,
                        c.price_min_usd != null || c.price_max_usd != null
                          ? `$${c.price_min_usd ?? 0}-${c.price_max_usd ?? "∞"}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || t("customers.criteriaNoFilters")}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={async () => {
                      const supabase = createClient();
                      await supabase
                        .from("customer_wish_criteria")
                        .delete()
                        .eq("criteria_id", c.criteria_id);
                      reloadCriteria();
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <CriteriaAdd customerId={form.customer_id} onAdded={reloadCriteria} />
          </div>

          {/* Purchase history - what they've actually bought (drives preferences + reach-out). */}
          <div className="space-y-2 border-t pt-3">
            <Label className="flex items-center gap-1.5">
              <History className="size-3.5" /> {t("customers.purchases")}
              {purchases.length > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  · {t("customers.totalSpent").replace("{v}", `$${totalSpent.toFixed(0)}`)}
                </span>
              )}
            </Label>
            {purchases.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("customers.purchasesEmpty")}</p>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {purchases.map((p) => (
                  <div key={`${p.game}-${p.sale_id}`} className="flex items-center gap-2 text-sm">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">{p.sold_at}</span>
                    <span className="flex-1 truncate">
                      {purchaseLabel(p)}
                      {p.quantity > 1 && <span className="text-muted-foreground"> ×{p.quantity}</span>}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums">${Number(p.gross_usd).toFixed(0)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="flex items-center justify-between">
          <Button variant="ghost" className="text-destructive" onClick={remove} disabled={busy}>
            <Trash2 className="size-3.5" /> {t("customers.delete")}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Pokemon rarity taxonomy (from TCGplayer's extendedData; matches CardBrowser).
// Used as the option list for the rarities multi-select.
const POKEMON_RARITY_OPTIONS = [
  "Common", "Uncommon", "Rare", "Holo Rare", "Double Rare", "Super Rare",
  "Ultra Rare", "Shiny Rare", "Shiny Secret Rare",
  "Art Rare", "Special Art Rare", "Hyper Rare", "Triple Rare",
  "Character Rare", "Character Super Rare", "Trainer Rare", "Prism Rare",
  "ACE Rare", "Amazing Rare", "Radiant Rare",
];

interface SetOption { set_code: string; name: string; release_date: string | null; }

function CriteriaAdd({ customerId, onAdded }: { customerId: number; onAdded: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [game, setGame] = useState<string>("pokemon");
  const [label, setLabel] = useState("");
  const [rarities, setRarities] = useState<string[]>([]);
  const [setAfter, setSetAfter] = useState("");
  const [setBefore, setSetBefore] = useState("");
  const [jpOnly, setJpOnly] = useState(false);
  const [promoOnly, setPromoOnly] = useState(false);
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [priority, setPriority] = useState("3");
  const [busy, setBusy] = useState(false);
  const [sets, setSets] = useState<SetOption[]>([]);

  // Load pokemon sets (JP) newest first so the set-range dropdowns can render
  // real options instead of free-text - user's #1 complaint was typing "M5"
  // and not knowing if it resolved. Only for pokemon; MTG uses free text (54k
  // sets are too many for a dropdown, and users know the codes).
  useEffect(() => {
    if (!open || game !== "pokemon") return;
    const supabase = createClient();
    supabase.from("pokemon_sets")
      .select("set_code, name, release_date")
      .eq("language", "jp")
      .order("release_date", { ascending: false })
      .then(({ data }) => setSets((data ?? []) as SetOption[]));
  }, [open, game]);

  useEffect(() => {
    if (!open) {
      setLabel("");
      setRarities([]);
      setSetAfter("");
      setSetBefore("");
      setJpOnly(false);
      setPromoOnly(false);
      setPriceMin("");
      setPriceMax("");
    }
  }, [open]);

  async function add() {
    if (busy) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.from("customer_wish_criteria").insert({
      customer_id: customerId,
      game,
      label: label.trim() || null,
      rarities: rarities.length ? rarities : null,
      set_after_code: setAfter.trim() || null,
      set_before_code: setBefore.trim() || null,
      languages: game === "pokemon" || game === "pokemon_sealed" ? ["jp"] : null,
      is_japan_exclusive: jpOnly ? true : null,
      is_promo: promoOnly ? true : null,
      price_min_usd: priceMin ? Number(priceMin) : null,
      price_max_usd: priceMax ? Number(priceMax) : null,
      priority: Number(priority) || 3,
    });
    setBusy(false);
    onAdded();
    setOpen(false);
  }

  function toggleRarity(r: string) {
    setRarities((prev) => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
  }

  return (
    <>
      <Button variant="outline" size="sm" className="w-fit" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" /> {t("customers.criteriaAdd")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("customers.criteriaAdd")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Name (label) on its own row so users can find it. Previous
                layout hid it as a placeholder in a row of controls. */}
            <div>
              <Label className="text-xs mb-1 block">{t("customers.criteriaLabel")}</Label>
              <Input
                placeholder={t("customers.criteriaLabelPlaceholder") as string}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-xs mb-1 block">{t("common.game")}</Label>
                <select
                  className={`${selectClass}`}
                  value={game}
                  onChange={(e) => setGame(e.target.value)}
                >
                  {GAMES.map((g) => (
                    <option key={g} value={g}>{t(`game.${g}` as never)}</option>
                  ))}
                </select>
              </div>
              <div className="w-24">
                <Label className="text-xs mb-1 block">{t("customers.criteriaPriority")}</Label>
                <select
                  className={`${selectClass}`}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  {[1, 2, 3, 4, 5].map((p) => (
                    <option key={p} value={p}>P{p}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Price range - both min and max, so "above $25 below $200" works. */}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-xs mb-1 block">{t("customers.criteriaPriceMin")}</Label>
                <Input
                  placeholder="≥$"
                  value={priceMin}
                  onChange={(e) => setPriceMin(e.target.value)}
                />
              </div>
              <div className="flex-1">
                <Label className="text-xs mb-1 block">{t("customers.criteriaPriceMax")}</Label>
                <Input
                  placeholder="≤$"
                  value={priceMax}
                  onChange={(e) => setPriceMax(e.target.value)}
                />
              </div>
            </div>

            {/* Rarities as a chip multi-select. Pokemon-only; MTG rarities
                aren't populated on the catalog side yet. */}
            {game === "pokemon" && (
              <div>
                <Label className="text-xs mb-1 block">{t("customers.criteriaRarities")}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {POKEMON_RARITY_OPTIONS.map((r) => {
                    const on = rarities.includes(r);
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => toggleRarity(r)}
                        className={`rounded-full border px-2 py-0.5 text-xs transition ${on ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}
                      >
                        {r}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Set-range dropdowns. For pokemon we load from pokemon_sets so
                users pick from a real list; for other games it stays free-text
                because the catalogs are too large / not populated for a dropdown. */}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-xs mb-1 block">{t("customers.criteriaSetAfter")}</Label>
                {game === "pokemon" ? (
                  <select
                    className={selectClass}
                    value={setAfter}
                    onChange={(e) => setSetAfter(e.target.value)}
                  >
                    <option value="">-</option>
                    {sets.map((s) => (
                      <option key={s.set_code} value={s.set_code}>
                        {s.set_code} {s.name ? `- ${s.name}` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    placeholder={t("customers.criteriaSetAfter") as string}
                    value={setAfter}
                    onChange={(e) => setSetAfter(e.target.value)}
                  />
                )}
              </div>
              <div className="flex-1">
                <Label className="text-xs mb-1 block">{t("customers.criteriaSetBefore")}</Label>
                {game === "pokemon" ? (
                  <select
                    className={selectClass}
                    value={setBefore}
                    onChange={(e) => setSetBefore(e.target.value)}
                  >
                    <option value="">-</option>
                    {sets.map((s) => (
                      <option key={s.set_code} value={s.set_code}>
                        {s.set_code} {s.name ? `- ${s.name}` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    placeholder={t("customers.criteriaSetBefore") as string}
                    value={setBefore}
                    onChange={(e) => setSetBefore(e.target.value)}
                  />
                )}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={jpOnly}
                  onChange={(e) => setJpOnly(e.target.checked)}
                />
                JP exclusive
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={promoOnly}
                  onChange={(e) => setPromoOnly(e.target.checked)}
                />
                Promo
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button onClick={add} disabled={busy}>
              {busy ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function WishlistAdd({ customerId, onAdded }: { customerId: number; onAdded: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [game, setGame] = useState<string>("pokemon_sealed");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: number; label: string }[]>([]);
  const [maxPrice, setMaxPrice] = useState("");
  const [priority, setPriority] = useState("3");

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const h = setTimeout(() => searchCatalog(game, q).then(setResults), 300);
    return () => clearTimeout(h);
  }, [game, query]);

  // Reset form state whenever the dialog re-opens.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setMaxPrice("");
    }
  }, [open]);

  async function add(id: number) {
    const supabase = createClient();
    await supabase.from("customer_wishlist").insert({
      customer_id: customerId,
      game,
      card_id: game === "pokemon_sealed" ? null : id,
      product_id: game === "pokemon_sealed" ? id : null,
      max_price_usd: maxPrice ? Number(maxPrice) : null,
      priority: Number(priority) || 3,
    });
    onAdded();
    setOpen(false);
  }

  return (
    <>
      <Button variant="outline" size="sm" className="w-fit" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" /> {t("customers.wishlistAdd")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("customers.wishlistAdd")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <select
                className={`${selectClass} w-32`}
                value={game}
                onChange={(e) => setGame(e.target.value)}
              >
                {GAMES.map((g) => (
                  <option key={g} value={g}>
                    {t(`game.${g}` as never)}
                  </option>
                ))}
              </select>
              <Input
                className="w-20"
                placeholder="≤$"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
              />
              <select
                className={`${selectClass} w-14`}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                {[1, 2, 3, 4, 5].map((p) => (
                  <option key={p} value={p}>
                    P{p}
                  </option>
                ))}
              </select>
            </div>
            <Input
              autoFocus
              placeholder={t("customers.wishlistSearch")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("customers.wishlistClickToAdd")}
            </p>
            {results.length > 0 ? (
              <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border">
                {results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => add(r.id)}
                    className="block w-full truncate px-2 py-1 text-left text-xs hover:bg-muted"
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            ) : query.trim() ? (
              <p className="text-xs text-muted-foreground">{t("customers.wishlistNoResults")}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
