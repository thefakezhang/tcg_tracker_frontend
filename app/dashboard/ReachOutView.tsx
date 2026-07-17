"use client";

import { useMemo, useState } from "react";
import { Send, Search, Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/select-all";
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
  // Discriminator + optional criterion label so grouped rendering can label
  // criterion-matched rows with the criterion they came from.
  origin: "wishlist" | "criteria";
  criteria_label?: string | null;
}

interface CriteriaReachoutRaw {
  criteria_id: number;
  customer_id: number;
  customer_name: string;
  handles: Record<string, string> | null;
  next_followup_at: string | null;
  label: string | null;
  game: string;
  card_id: number | null;
  product_id: number | null;
  priority: number;
  price_max_usd: number | null;
  item_name: string;
  english_name: string | null;
  set_code: string | null;
  card_number: string | null;
  misc_info: string | null;
  rarity: string | null;
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
  // `.limit(1000)` sat exactly ON PostgREST's max_rows, so a full page and a
  // truncated page were byte-identical - the follow-up list would silently lose
  // everyone past row 1000 with no signal. Page on each view's grain instead:
  // customer_reachout_v keys on wishlist_id; the criteria view is one row per
  // (criterion x matching stock item), i.e. (criteria_id, game, card_id,
  // product_id). Priority (the display sort) is re-applied below.
  const [wishlistData, criteriaData] = await Promise.all([
    selectAll<Omit<ReachoutRow, "origin" | "criteria_label">>(
      () => supabase.from("customer_reachout_v").select("*"),
      ["wishlist_id"],
    ),
    selectAll<CriteriaReachoutRaw>(
      () => supabase.from("customer_reachout_criteria_v").select("*"),
      ["criteria_id", "game", "card_id", "product_id"],
    ),
  ]);
  const wishlistRows: ReachoutRow[] = wishlistData.map((r) => ({ ...r, origin: "wishlist" as const }));
  const criteriaRows: ReachoutRow[] = criteriaData.map((r) => ({
    // Reuse a stable wishlist_id-like key so React can key rows uniquely;
    // criterion rows use a synthetic negative id derived from (criteria_id, card_id).
    wishlist_id: -(r.criteria_id * 1_000_000 + (r.card_id ?? r.product_id ?? 0)),
    customer_id: r.customer_id,
    customer_name: r.customer_name,
    handles: r.handles,
    next_followup_at: r.next_followup_at,
    game: r.game,
    priority: r.priority,
    max_price_usd: r.price_max_usd,
    wishlist_notes: null,
    item_name: r.english_name || r.item_name,
    set_code: r.set_code,
    card_number: r.card_number,
    misc_info: r.misc_info,
    qty_on_hand: r.qty_on_hand,
    avg_cost_usd: r.avg_cost_usd,
    origin: "criteria" as const,
    criteria_label: r.label,
  }));
  // selectAll pages in key order, so re-impose the priority order the two
  // `.order("priority")` queries used to provide (the grouping below keys off
  // priority; keeping rows priority-sorted preserves within-customer order too).
  return [...wishlistRows, ...criteriaRows].sort((a, b) => a.priority - b.priority);
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
                        {r.origin === "criteria" && r.criteria_label && (
                          <Badge variant="secondary" className="ml-1.5 text-[10px]" title={t("reachout.viaCriterion")}>
                            {r.criteria_label}
                          </Badge>
                        )}
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
