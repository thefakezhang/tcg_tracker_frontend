"use client";

import { useMemo, useState } from "react";
import { Send, Search, Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSupabaseQuery, QueryError } from "./use-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// Reach out (docs/customers_crm.md, Phase 3): the money view. Reads
// customer_reachout_v - wishlist items that are in your inventory right now -
// grouped by customer, so it answers "who can I sell to today, from stock."

interface ReachoutRow {
  customer_id: number;
  customer_name: string;
  handles: Record<string, string> | null;
  next_followup_at: string | null;
  wishlist_id: number;
  game: string;
  priority: number;
  max_price_usd: number | null;
  wishlist_notes: string | null;
  item_name: string;
  set_code: string | null;
  card_number: string | null;
  misc_info: string | null;
  qty_on_hand: number;
  avg_cost_usd: number | null;
}

interface CustomerGroup {
  customer_id: number;
  customer_name: string;
  handles: Record<string, string> | null;
  next_followup_at: string | null;
  topPriority: number;
  rows: ReachoutRow[];
}

function itemMeta(r: ReachoutRow): string {
  const parts: string[] = [];
  if (r.set_code && r.set_code !== "UNKNOWN") parts.push(r.set_code);
  if (r.card_number) parts.push(r.card_number);
  const base = parts.join(" ");
  const misc = r.misc_info && r.misc_info !== "UNKNOWN" ? ` (${r.misc_info})` : "";
  return base + misc;
}

async function fetchReachout(): Promise<ReachoutRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("customer_reachout_v")
    .select("*")
    .order("priority")
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as ReachoutRow[];
}

export default function ReachOutView() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const { data, error, isLoading, retry } = useSupabaseQuery(["reachout"], fetchReachout);
  const today = new Date().toISOString().slice(0, 10);

  const groups = useMemo<CustomerGroup[]>(() => {
    const rows = data ?? [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? rows.filter(
          (r) => r.customer_name.toLowerCase().includes(q) || r.item_name.toLowerCase().includes(q),
        )
      : rows;
    const map = new Map<number, CustomerGroup>();
    for (const r of filtered) {
      let g = map.get(r.customer_id);
      if (!g) {
        g = {
          customer_id: r.customer_id,
          customer_name: r.customer_name,
          handles: r.handles,
          next_followup_at: r.next_followup_at,
          topPriority: r.priority,
          rows: [],
        };
        map.set(r.customer_id, g);
      }
      g.rows.push(r);
      g.topPriority = Math.min(g.topPriority, r.priority);
    }
    // Best (lowest) priority first, then most matches.
    return [...map.values()].sort(
      (a, b) => a.topPriority - b.topPriority || b.rows.length - a.rows.length,
    );
  }, [data, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Send className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t("reachout.title")}</h1>
          {!isLoading && (
            <span className="text-sm text-muted-foreground">
              {t("reachout.count").replace("{n}", String(groups.length))}
            </span>
          )}
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={t("reachout.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error ? (
        <QueryError onRetry={retry} />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("reachout.empty")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {groups.map((g) => {
            const contact = Object.entries(g.handles ?? {})
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ");
            const followupDue = g.next_followup_at != null && g.next_followup_at <= today;
            return (
              <div key={g.customer_id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{g.customer_name}</span>
                      {followupDue && (
                        <Badge variant="outline" className="gap-1 text-[10px] text-amber-600">
                          <Bell className="size-3" /> {t("reachout.followupDue")}
                        </Badge>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {contact || t("reachout.noContact")}
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {t("reachout.matches").replace("{n}", String(g.rows.length))}
                  </Badge>
                </div>

                <div className="mt-2 space-y-1 border-t pt-2">
                  {g.rows.map((r) => (
                    <div key={r.wishlist_id} className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        P{r.priority}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate">
                        {r.item_name}
                        {itemMeta(r) && <span className="text-muted-foreground"> · {itemMeta(r)}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
                        <span title={t("reachout.youHold")}>×{r.qty_on_hand}</span>
                        {r.max_price_usd != null && (
                          <span className="text-foreground" title={t("reachout.theyPay")}>
                            ≤${Number(r.max_price_usd).toFixed(0)}
                          </span>
                        )}
                        {r.avg_cost_usd != null && (
                          <span title={t("reachout.yourCost")}>${Number(r.avg_cost_usd).toFixed(0)}</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
