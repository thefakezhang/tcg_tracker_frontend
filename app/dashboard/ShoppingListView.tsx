"use client";

import { useMemo, useState } from "react";
import { ShoppingCart, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSupabaseQuery, QueryError } from "./use-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// Pre-trip shopping list (docs/customers_crm.md, Phase 5): the "what should I
// hunt for on this trip" view. Reads customer_shopping_list_v — every card
// that at least one customer wants via a criteria row, aggregated across
// customers. Rows sort by cumulative interest (interested_customers DESC)
// then priority (top_priority ASC) so the highest-leverage picks show first.
//
// This is the surface the current reach-out flow can't provide: reach-out
// requires stock or completed acquisitions, so it fires post-purchase.
// Shopping-list surfaces demand DURING planning.

interface ShoppingRow {
  game: string;
  card_id: number | null;
  product_id: number | null;
  item_name: string;
  english_name: string | null;
  set_code: string | null;
  card_number: string | null;
  misc_info: string | null;
  rarity: string | null;
  is_japan_exclusive: boolean | null;
  release_date: string | null;
  interested_customers: number;
  top_priority: number;
  top_ceiling_usd: number | null;
  customer_ids: number[];
}

async function fetchShoppingList(): Promise<ShoppingRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("customer_shopping_list_v")
    .select("*")
    .order("interested_customers", { ascending: false })
    .order("top_priority", { ascending: true })
    .limit(2000);
  if (error) throw error;
  return (data ?? []) as ShoppingRow[];
}

function itemMeta(r: ShoppingRow): string {
  const parts: string[] = [];
  if (r.set_code && r.set_code !== "UNKNOWN") parts.push(r.set_code);
  if (r.card_number) parts.push(r.card_number);
  const misc = r.misc_info && r.misc_info !== "UNKNOWN" ? ` (${r.misc_info})` : "";
  return parts.join(" ") + misc;
}

export default function ShoppingListView() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const { data, error, isLoading, retry } = useSupabaseQuery(["shopping-list"], fetchShoppingList);

  const rows = useMemo(() => {
    const all = data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (r) =>
        r.item_name.toLowerCase().includes(q) ||
        (r.english_name ?? "").toLowerCase().includes(q) ||
        (r.set_code ?? "").toLowerCase().includes(q) ||
        (r.card_number ?? "").toLowerCase().includes(q) ||
        (r.rarity ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <ShoppingCart className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t("shoppingList.title")}</h1>
          {!isLoading && (
            <span className="text-sm text-muted-foreground">
              {t("shoppingList.count").replace("{n}", String(rows.length))}
            </span>
          )}
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={t("shoppingList.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error ? (
        <QueryError onRetry={retry} />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("shoppingList.empty")}</p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t("shoppingList.item")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("shoppingList.set")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("shoppingList.rarity")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("shoppingList.buyers")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("shoppingList.topPriority")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("shoppingList.topCeiling")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.game}-${r.card_id ?? r.product_id}`} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">{r.english_name || r.item_name}</span>
                      {r.is_japan_exclusive && (
                        <Badge variant="outline" className="shrink-0 text-[10px]">JP</Badge>
                      )}
                    </div>
                    {r.english_name && r.item_name !== r.english_name && (
                      <div className="truncate text-xs text-muted-foreground">{r.item_name}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">
                    {itemMeta(r) || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted-foreground">
                    {r.rarity ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                    <Badge variant="secondary" className="text-[10px]">
                      ×{r.interested_customers}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                    <Badge variant="outline" className="text-[10px]">
                      P{r.top_priority}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-xs">
                    {r.top_ceiling_usd != null ? `≤$${Number(r.top_ceiling_usd).toFixed(0)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
