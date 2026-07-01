"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";

// Trip reach-out (docs/customers_crm.md, Phase 4): the "when traveling" panel.
// customer_trip_match_v = customers whose active wishlist matches what you bought /
// are buying on THIS trip, plus follow-ups due by the trip's end.

interface TripMatchRow {
  trip_id: number;
  leg: string;
  customer_id: number;
  customer_name: string;
  handles: Record<string, string> | null;
  wishlist_id: number;
  priority: number;
  max_price_usd: number | null;
  item_name: string;
  english_name: string | null;
  set_code: string | null;
  card_number: string | null;
  misc_info: string | null;
  qty_on_trip: number;
}
interface FollowupRow {
  customer_id: number;
  name: string;
  handles: Record<string, string> | null;
  next_followup_at: string;
}
interface MatchGroup {
  customer_id: number;
  customer_name: string;
  handles: Record<string, string> | null;
  topPriority: number;
  rows: TripMatchRow[];
}

function itemMeta(r: TripMatchRow): string {
  const parts: string[] = [];
  if (r.set_code && r.set_code !== "UNKNOWN") parts.push(r.set_code);
  if (r.card_number) parts.push(r.card_number);
  const misc = r.misc_info && r.misc_info !== "UNKNOWN" ? ` (${r.misc_info})` : "";
  return parts.join(" ") + misc;
}
function contactOf(handles: Record<string, string> | null): string {
  return Object.entries(handles ?? {}).map(([k, v]) => `${k}: ${v}`).join(" · ");
}

export default function TripReachoutTab({ tripId, tripEnd }: { tripId: number; tripEnd: string | null }) {
  const { t } = useTranslation();
  const [matches, setMatches] = useState<TripMatchRow[]>([]);
  const [followups, setFollowups] = useState<FollowupRow[]>([]);
  const cutoff = tripEnd || new Date().toISOString().slice(0, 10);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("customer_trip_match_v")
      .select("*")
      .eq("trip_id", tripId)
      .order("priority")
      .then(({ data }) => setMatches((data ?? []) as TripMatchRow[]));
    supabase
      .from("customers")
      .select("customer_id, name, handles, next_followup_at")
      .not("next_followup_at", "is", null)
      .lte("next_followup_at", cutoff)
      .order("next_followup_at")
      .then(({ data }) => setFollowups((data ?? []) as FollowupRow[]));
  }, [tripId, cutoff]);

  const groups = useMemo<MatchGroup[]>(() => {
    const map = new Map<number, MatchGroup>();
    for (const r of matches) {
      let g = map.get(r.customer_id);
      if (!g) {
        g = { customer_id: r.customer_id, customer_name: r.customer_name, handles: r.handles, topPriority: r.priority, rows: [] };
        map.set(r.customer_id, g);
      }
      g.rows.push(r);
      g.topPriority = Math.min(g.topPriority, r.priority);
    }
    return [...map.values()].sort((a, b) => a.topPriority - b.topPriority || b.rows.length - a.rows.length);
  }, [matches]);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("tripReach.matchesTitle")}</h3>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("tripReach.empty")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {groups.map((g) => (
              <div key={g.customer_id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{g.customer_name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {contactOf(g.handles) || t("reachout.noContact")}
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {t("reachout.matches").replace("{n}", String(g.rows.length))}
                  </Badge>
                </div>
                <div className="mt-2 space-y-1 border-t pt-2">
                  {g.rows.map((r) => (
                    <div key={r.wishlist_id} className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="shrink-0 text-[10px]">P{r.priority}</Badge>
                      <span className="min-w-0 flex-1 truncate">
                        {r.english_name || r.item_name}
                        {itemMeta(r) && <span className="text-muted-foreground"> · {itemMeta(r)}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
                        <Badge variant="outline" className="text-[10px]">
                          {t(r.leg === "export" ? "trips.legExport" : "trips.legImport")}
                        </Badge>
                        <span title={t("tripReach.buying")}>×{r.qty_on_trip}</span>
                        {r.max_price_usd != null && (
                          <span className="text-foreground" title={t("reachout.theyPay")}>
                            ≤${Number(r.max_price_usd).toFixed(0)}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Bell className="size-4 text-amber-500" /> {t("tripReach.followupsTitle")}
        </h3>
        {followups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("tripReach.followupsEmpty")}</p>
        ) : (
          <div className="space-y-1">
            {followups.map((f) => (
              <div key={f.customer_id} className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                <span className="w-20 shrink-0 text-xs text-muted-foreground">{f.next_followup_at}</span>
                <span className="shrink-0 font-medium">{f.name}</span>
                <span className="truncate text-xs text-muted-foreground">{contactOf(f.handles)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
