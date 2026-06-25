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
// one place, read from sales_ledger_v (migration 085) — which resolves name,
// the REAL leg (from the cost layers, not currency), and the reverted flag in
// SQL. (The per-trip Sales tab is for RECORDING a sale; this is the history.)
const PAGE = 300; // sales per fetch; "Load more" raises it

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

type LedgerRow = {
  sale_id: number; game: string; sale_group: number | null;
  regional_name: string; set_code: string; card_number: string | null;
  leg: "import" | "export" | null; sold_at: string; quantity: number;
  gross_usd: number; cogs_usd: number; margin_usd: number; is_reverted: boolean;
};

async function fetchGlobalSales(limit: number): Promise<{ sales: Sale[]; truncated: boolean }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("sales_ledger_v")
    .select("sale_id, game, sale_group, regional_name, set_code, card_number, leg, sold_at, quantity, gross_usd, cogs_usd, margin_usd, is_reverted")
    .order("sold_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data as LedgerRow[]) ?? [];
  const sales: Sale[] = rows
    .filter((r) => !r.is_reverted) // reverted sales drop out (the revert undid them)
    .map((r) => ({
      key: `${r.game}-${r.sale_id}`,
      name: `${r.regional_name} · ${r.set_code} ${r.card_number ?? ""}`.trim(),
      leg: r.leg ?? "import",
      sold_at: r.sold_at, quantity: r.quantity,
      gross_usd: r.gross_usd, cogs_usd: r.cogs_usd, margin_usd: r.margin_usd, sale_group: r.sale_group,
    }));
  return { sales, truncated: rows.length >= limit };
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
