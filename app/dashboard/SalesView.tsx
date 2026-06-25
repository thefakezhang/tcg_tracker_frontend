"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSupabaseQuery, QueryError } from "./use-query";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// Global sales ledger: every recorded sale across all trips and both legs, in
// one place. (The per-trip Sales tab is for RECORDING a sale from inventory;
// this is the read-only history of everything we've sold.)
type CardGame = "pokemon" | "mtg";
const DEF_TABLE: Record<CardGame, string> = {
  pokemon: "pokemon_card_definitions",
  mtg: "mtg_card_definitions_v",
};
const PAGE = 300; // sales per source table per fetch; "Load more" raises it

interface Sale {
  key: string;
  name: string;
  leg: "import" | "export";
  sold_at: string;
  quantity: number;
  gross_usd: number;
  cogs_usd: number;
  margin_usd: number;
  sale_group: number | null;
}

// Leg isn't stored on the sale row; it's inferred from the sale currency —
// import sells in the US (USD), export sells in Japan (native JPY).
const legOf = (orig_currency: string | null): "import" | "export" =>
  orig_currency && orig_currency.toUpperCase() !== "USD" ? "export" : "import";

const SEL = "sale_id, sold_at, quantity, gross_usd, cogs_usd, margin_usd, sale_group, reverses_sale_id, orig_currency";

type RawCard = { sale_id: number; card_id: number; sold_at: string; quantity: number; gross_usd: number; cogs_usd: number; margin_usd: number; sale_group: number | null; reverses_sale_id: number | null; orig_currency: string | null };
type RawSealed = Omit<RawCard, "card_id"> & { product_id: number };

async function fetchGlobalSales(limit: number): Promise<{ sales: Sale[]; truncated: boolean }> {
  const supabase = createClient();
  // The three source tables in parallel.
  const [pk, mtg, sealed] = await Promise.all([
    supabase.from("pokemon_sales").select(`card_id, ${SEL}`).order("sold_at", { ascending: false }).limit(limit),
    supabase.from("mtg_sales").select(`card_id, ${SEL}`).order("sold_at", { ascending: false }).limit(limit),
    supabase.from("pokemon_sealed_sales").select(`product_id, ${SEL}`).order("sold_at", { ascending: false }).limit(limit),
  ]);
  for (const r of [pk, mtg, sealed]) if (r.error) throw r.error; // surface read failures (don't blank silently)

  const out: Sale[] = [];
  const reverted = new Set<string>();
  let truncated = false;

  for (const [game, res] of [["pokemon", pk], ["mtg", mtg]] as const) {
    const rows = (res.data as RawCard[]) ?? [];
    if (rows.length >= limit) truncated = true;
    for (const r of rows) if (r.reverses_sale_id != null) reverted.add(`${game}-${r.reverses_sale_id}`);
    const origs = rows.filter((r) => r.reverses_sale_id == null);
    const ids = [...new Set(origs.map((r) => r.card_id))];
    const nameMap = new Map<number, string>();
    if (ids.length) {
      const { data: defs } = await supabase.from(DEF_TABLE[game]).select("card_id, regional_name, set_code, card_number").in("card_id", ids);
      for (const d of (defs as { card_id: number; regional_name: string; set_code: string; card_number: string | null }[]) ?? []) {
        nameMap.set(d.card_id, `${d.regional_name} · ${d.set_code} ${d.card_number ?? ""}`.trim());
      }
    }
    for (const r of origs) out.push({
      key: `${game}-${r.sale_id}`, name: nameMap.get(r.card_id) ?? `#${r.card_id}`,
      leg: legOf(r.orig_currency), sold_at: r.sold_at, quantity: r.quantity,
      gross_usd: r.gross_usd, cogs_usd: r.cogs_usd, margin_usd: r.margin_usd, sale_group: r.sale_group,
    });
  }

  const srows = (sealed.data as RawSealed[]) ?? [];
  if (srows.length >= limit) truncated = true;
  for (const r of srows) if (r.reverses_sale_id != null) reverted.add(`sealed-${r.reverses_sale_id}`);
  const sorigs = srows.filter((r) => r.reverses_sale_id == null);
  if (sorigs.length > 0) {
    const { data: prods } = await supabase.from("pokemon_sealed_products").select("product_id, name, set_code").in("product_id", [...new Set(sorigs.map((r) => r.product_id))]);
    const pMap = new Map<number, string>();
    for (const p of (prods as { product_id: number; name: string; set_code: string }[]) ?? []) pMap.set(p.product_id, `${p.name} · ${p.set_code}`);
    for (const r of sorigs) out.push({
      key: `sealed-${r.sale_id}`, name: pMap.get(r.product_id) ?? `#${r.product_id}`,
      leg: legOf(r.orig_currency), sold_at: r.sold_at, quantity: r.quantity,
      gross_usd: r.gross_usd, cogs_usd: r.cogs_usd, margin_usd: r.margin_usd, sale_group: r.sale_group,
    });
  }

  // Reverted sales drop out entirely (the revert undid them).
  const live = out.filter((o) => !reverted.has(o.key));
  live.sort((a, b) => (a.sold_at < b.sold_at ? 1 : -1));
  return { sales: live, truncated };
}

export default function SalesView() {
  const { t } = useTranslation();
  const [leg, setLeg] = useState<"all" | "import" | "export">("all");
  const [limit, setLimit] = useState(PAGE);
  const { data, error, isLoading, retry } = useSupabaseQuery(
    ["global-sales", limit], () => fetchGlobalSales(limit));
  const sales = data?.sales ?? [];

  // Collapse lot sales (shared sale_group) into one event row.
  type Event = { gid: string; items: Sale[]; leg: "import" | "export"; sold_at: string; qty: number; gross: number; cogs: number; margin: number };
  const events = useMemo<Event[]>(() => {
    const filtered = leg === "all" ? sales : sales.filter((s) => s.leg === leg);
    const map = new Map<string, Sale[]>();
    for (const s of filtered) {
      const gid = s.sale_group != null ? `g${s.sale_group}` : `s${s.key}`;
      const arr = map.get(gid); if (arr) arr.push(s); else map.set(gid, [s]);
    }
    return [...map.entries()].map(([gid, items]) => ({
      gid, items, leg: items[0].leg, sold_at: items[0].sold_at,
      qty: items.reduce((a, i) => a + i.quantity, 0),
      gross: items.reduce((a, i) => a + Number(i.gross_usd), 0),
      cogs: items.reduce((a, i) => a + Number(i.cogs_usd), 0),
      margin: items.reduce((a, i) => a + Number(i.margin_usd), 0),
    }));
  }, [sales, leg]);

  const total = useMemo(() => ({
    gross: events.reduce((a, e) => a + e.gross, 0),
    margin: events.reduce((a, e) => a + e.margin, 0),
  }), [events]);

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t("sales.allTitle")}</h1>
        <Tabs value={leg} onValueChange={(v) => setLeg(String(v) as "all" | "import" | "export")}>
          <TabsList>
            <TabsTrigger value="all">{t("sales.legAll")}</TabsTrigger>
            <TabsTrigger value="import">{t("trips.legImport")}</TabsTrigger>
            <TabsTrigger value="export">{t("trips.legExport")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {error && <QueryError onRetry={retry} />}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">{t("trips.month")}</TableHead>
            <TableHead>{t("trips.item")}</TableHead>
            <TableHead className="w-20">{t("trips.leg")}</TableHead>
            <TableHead className="w-12">{t("trips.qty")}</TableHead>
            <TableHead className="w-24">{t("trips.saleGross")}</TableHead>
            <TableHead className="w-24">{t("trips.saleCogs")}</TableHead>
            <TableHead className="w-24">{t("trips.saleMargin")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((e) => (
            <TableRow key={e.gid}>
              <TableCell>{e.sold_at}</TableCell>
              <TableCell className="truncate max-w-[280px]">
                {e.items.length > 1 ? t("trips.lotItems", { n: e.items.length }) : e.items[0].name}
              </TableCell>
              <TableCell>
                <Badge variant={e.leg === "export" ? "secondary" : "outline"}>
                  {e.leg === "export" ? t("trips.legExport") : t("trips.legImport")}
                </Badge>
              </TableCell>
              <TableCell>{e.qty}</TableCell>
              <TableCell>${e.gross.toFixed(0)}</TableCell>
              <TableCell>${e.cogs.toFixed(0)}</TableCell>
              <TableCell className={e.margin < 0 ? "text-destructive" : ""}>${e.margin.toFixed(0)}</TableCell>
            </TableRow>
          ))}
          {events.length === 0 && !error && (
            <TableRow><TableCell colSpan={7} className="text-muted-foreground">{isLoading ? t("common.loading") : t("trips.empty")}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between gap-2">
        {events.length > 0 && (
          <p className="text-sm font-medium">
            {t("sales.totalSummary", { gross: total.gross.toFixed(0), margin: total.margin.toFixed(0) })}
          </p>
        )}
        {data?.truncated && (
          <Button variant="outline" size="sm" disabled={isLoading} onClick={() => setLimit((l) => l + PAGE)}>
            {t("common.loadMore")}
          </Button>
        )}
      </div>
    </div>
  );
}
