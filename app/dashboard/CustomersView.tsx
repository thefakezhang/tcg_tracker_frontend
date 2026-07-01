"use client";

import { useEffect, useState } from "react";
import { Users, Search, Plus, Trash2, X, Star, Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSupabaseQuery, QueryError } from "./use-query";
import { useDebouncedValue } from "./use-card-data";
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

// searchCatalog finds catalog items by name for the wishlist picker.
async function searchCatalog(
  game: string,
  query: string,
): Promise<{ id: number; label: string }[]> {
  const supabase = createClient();
  const q = query.replace(/[%,]/g, " ");
  if (game === "pokemon_sealed") {
    const { data } = await supabase
      .from("pokemon_sealed_products")
      .select("product_id, name, set_code")
      .ilike("name", `%${q}%`)
      .limit(8);
    return (data ?? []).map((r: { product_id: number; name: string; set_code: string }) => ({
      id: r.product_id,
      label: `${r.name}${r.set_code && r.set_code !== "UNKNOWN" ? ` · ${r.set_code}` : ""}`,
    }));
  }
  const table = game === "mtg" ? "mtg_card_definitions_v" : "pokemon_card_definitions";
  const { data } = await supabase
    .from(table)
    .select("card_id, regional_name, english_name, set_code, card_number, misc_info")
    .or(`regional_name.ilike.%${q}%,english_name.ilike.%${q}%`)
    .limit(8);
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
  const labels = new Map<string, string>();
  const singleIds = items.filter((i) => i.card_id).map((i) => i.card_id as number);
  const sealedIds = items.filter((i) => i.product_id).map((i) => i.product_id as number);
  if (singleIds.length) {
    for (const table of ["pokemon_card_definitions", "mtg_card_definitions_v"]) {
      const { data } = await supabase
        .from(table)
        .select("card_id, regional_name, english_name, set_code, card_number, misc_info")
        .in("card_id", singleIds);
      for (const r of (data ?? []) as {
        card_id: number;
        regional_name: string;
        english_name: string | null;
        set_code: string;
        card_number: string;
        misc_info?: string | null;
      }[]) {
        labels.set(
          `c${r.card_id}`,
          `${r.english_name || r.regional_name} · ${r.set_code} ${r.card_number}${
            r.misc_info && r.misc_info !== "UNKNOWN" ? ` (${r.misc_info})` : ""
          }`,
        );
      }
    }
  }
  if (sealedIds.length) {
    const { data } = await supabase
      .from("pokemon_sealed_products")
      .select("product_id, name, set_code")
      .in("product_id", sealedIds);
    for (const r of (data ?? []) as { product_id: number; name: string; set_code: string }[]) {
      labels.set(`p${r.product_id}`, r.name);
    }
  }
  return items.map((i) => ({
    ...i,
    label: i.card_id ? labels.get(`c${i.card_id}`) : labels.get(`p${i.product_id}`),
  }));
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        .then(({ data }) => resolveWishlist((data ?? []) as WishlistItem[]).then(setWishlist));
    } else {
      setWishlist([]);
    }
  }, [customer]);

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
    setWishlist(await resolveWishlist((data ?? []) as WishlistItem[]));
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
            <Label className="flex items-center gap-1.5">
              <Star className="size-3.5" /> {t("customers.wishlist")}
            </Label>
            <div className="space-y-1">
              {wishlist.length === 0 && (
                <p className="text-xs text-muted-foreground">{t("customers.wishlistEmpty")}</p>
              )}
              {wishlist.map((w) => (
                <div key={w.wishlist_id} className="flex items-center gap-2 text-sm">
                  <span className="w-8 shrink-0 text-xs text-muted-foreground">P{w.priority}</span>
                  <span className="flex-1 truncate">{w.label ?? `#${w.card_id ?? w.product_id}`}</span>
                  {w.max_price_usd != null && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      ≤${Number(w.max_price_usd).toFixed(0)}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={async () => {
                      const supabase = createClient();
                      await supabase
                        .from("customer_wishlist")
                        .delete()
                        .eq("wishlist_id", w.wishlist_id);
                      reloadWishlist();
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <WishlistAdd customerId={form.customer_id} onAdded={reloadWishlist} />
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

function WishlistAdd({ customerId, onAdded }: { customerId: number; onAdded: () => void }) {
  const { t } = useTranslation();
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
    setQuery("");
    setResults([]);
    setMaxPrice("");
    onAdded();
  }

  return (
    <div className="space-y-1 rounded-md border border-dashed p-2">
      <div className="flex items-center gap-2">
        <select className={`${selectClass} w-32`} value={game} onChange={(e) => setGame(e.target.value)}>
          {GAMES.map((g) => (
            <option key={g} value={g}>
              {t(`game.${g}` as never)}
            </option>
          ))}
        </select>
        <Input
          className="flex-1"
          placeholder={t("customers.wishlistSearch")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
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
      {results.length > 0 && (
        <div className="max-h-40 space-y-0.5 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => add(r.id)}
              className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-muted"
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
