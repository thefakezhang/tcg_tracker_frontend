"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { cardMeta } from "./use-card-data";
import { useSupabaseQuery, QueryError } from "./use-query";
import ReceiptsDialog from "./Receipts";
import { useSaleEditDialogs, type EditableSale } from "./SaleEditDialogs";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatUsdWhole } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// Global sales ledger: every recorded sale across all trips and both legs, in
// one place, read from sales_ledger_v (migration 085) — which resolves name,
// the REAL leg (from the cost layers, not currency), and the reverted flag in
// SQL. (The per-trip Sales tab is for RECORDING a sale; this is the history.)
// Committed sales are editable in place from here too - the pencil opens the
// shared SaleEditDialogs (edit_sale / edit_sealed_sale), single or whole lot.
const PAGE = 300; // sales per fetch; "Load more" raises it

interface Sale extends EditableSale {
  search: string; // lowercased name+english+set+number for filtering
  leg: "import" | "export";
  margin_usd: number;
  sale_group: number | null;
}

type LedgerRow = {
  sale_id: number; kind: "single" | "sealed"; game: string; sale_group: number | null;
  regional_name: string; english_name: string | null; set_code: string; card_number: string | null; misc_info: string | null;
  leg: "import" | "export" | null; sold_at: string; quantity: number;
  gross_usd: number; fees_usd: number; cogs_usd: number; margin_usd: number;
  orig_currency: string; proceeds_orig: number; fx_rate_used: number; is_reverted: boolean;
};

async function fetchGlobalSales(limit: number): Promise<{ sales: Sale[]; truncated: boolean }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("sales_ledger_v")
    .select("sale_id, kind, game, sale_group, regional_name, english_name, set_code, card_number, misc_info, leg, sold_at, quantity, gross_usd, fees_usd, cogs_usd, margin_usd, orig_currency, proceeds_orig, fx_rate_used, is_reverted")
    .order("sold_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data as LedgerRow[]) ?? [];
  const sales: Sale[] = rows
    .filter((r) => !r.is_reverted) // reverted sales drop out (the revert undid them)
    .map((r) => ({
      key: `${r.game}-${r.sale_id}`,
      kind: r.kind, game: r.game, sale_id: r.sale_id,
      name: `${r.regional_name} · ${cardMeta(r.set_code, r.card_number, r.misc_info)}`.trim(),
      search: `${r.regional_name} ${r.english_name ?? ""} ${r.set_code} ${r.card_number ?? ""}`.toLowerCase(),
      leg: r.leg ?? "import",
      sold_at: r.sold_at, quantity: r.quantity,
      gross_usd: r.gross_usd, fees_usd: r.fees_usd, cogs_usd: r.cogs_usd, margin_usd: r.margin_usd,
      orig_currency: r.orig_currency, proceeds_orig: r.proceeds_orig, fx_rate_used: r.fx_rate_used,
      sale_group: r.sale_group,
    } satisfies Sale));
  return { sales, truncated: rows.length >= limit };
}

export default function SalesView() {
  const { t, language } = useTranslation();
  const [leg, setLeg] = useState<"all" | "import" | "export">("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (gid: string) =>
    setExpanded((p) => { const n = new Set(p); if (n.has(gid)) n.delete(gid); else n.add(gid); return n; });
  const { data, error, isLoading, retry } = useSupabaseQuery(
    ["global-sales", limit], () => fetchGlobalSales(limit));
  const sales = data?.sales ?? [];
  // Edit a committed sale / lot in place - the same dialogs and RPC logic as
  // the per-trip Sales tab (SaleEditDialogs); refetch the ledger on save.
  const saleEdit = useSaleEditDialogs(async () => { await retry(); });

  // Collapse lot sales (shared sale_group) into one event row.
  type Event = { gid: string; items: Sale[]; game: string; sale_group: number | null; leg: "import" | "export"; sold_at: string; qty: number; gross: number; cogs: number; margin: number };
  const events = useMemo<Event[]>(() => {
    const q = search.trim().toLowerCase();
    const filtered = sales.filter((s) =>
      (leg === "all" || s.leg === leg) && (!q || s.search.includes(q)));
    const map = new Map<string, Sale[]>();
    for (const s of filtered) {
      // sale_group is per-game, so key lots by game+group (else pokemon g1 and mtg g1 merge).
      const gid = s.sale_group != null ? `g${s.game}-${s.sale_group}` : `s${s.key}`;
      const arr = map.get(gid); if (arr) arr.push(s); else map.set(gid, [s]);
    }
    return [...map.entries()].map(([gid, items]) => ({
      gid, items, game: items[0].game, sale_group: items[0].sale_group, leg: items[0].leg, sold_at: items[0].sold_at,
      qty: items.reduce((a, i) => a + i.quantity, 0),
      gross: items.reduce((a, i) => a + Number(i.gross_usd), 0),
      cogs: items.reduce((a, i) => a + Number(i.cogs_usd), 0),
      margin: items.reduce((a, i) => a + Number(i.margin_usd), 0),
    }));
  }, [sales, leg, search]);

  const total = useMemo(() => ({
    gross: events.reduce((a, e) => a + e.gross, 0),
    margin: events.reduce((a, e) => a + e.margin, 0),
  }), [events]);

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t("sales.allTitle")}</h1>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={t("sales.searchPlaceholder")} className="min-h-11 w-full sm:min-h-8 sm:w-56" />
        <Tabs value={leg} onValueChange={(v) => setLeg(String(v) as "all" | "import" | "export")}>
          <TabsList>
            <TabsTrigger value="all">{t("sales.legAll")}</TabsTrigger>
            <TabsTrigger value="import">{t("trips.legImport")}</TabsTrigger>
            <TabsTrigger value="export">{t("trips.legExport")}</TabsTrigger>
          </TabsList>
        </Tabs>
        </div>
      </div>

      {error && <QueryError onRetry={retry} />}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">{t("trips.date")}</TableHead>
            <TableHead>{t("trips.item")}</TableHead>
            <TableHead className="w-20">{t("trips.leg")}</TableHead>
            <TableHead className="w-12">{t("trips.qty")}</TableHead>
            <TableHead className="w-24">{t("trips.saleGross")}</TableHead>
            <TableHead className="w-24">{t("trips.saleCogs")}</TableHead>
            <TableHead className="w-24">{t("trips.saleMargin")}</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((e) => {
            const isLot = e.items.length > 1;
            const open = expanded.has(e.gid);
            return (
            <Fragment key={e.gid}>
            <TableRow className={isLot ? "cursor-pointer" : ""} onClick={isLot ? () => toggleExpand(e.gid) : undefined}>
              <TableCell>{formatDate(e.sold_at, language)}</TableCell>
              <TableCell className="truncate max-w-[280px]">
                <span className="flex items-center gap-1">
                  {isLot && (open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />)}
                  {isLot ? t("trips.lotItems", { n: e.items.length }) : e.items[0].name}
                </span>
              </TableCell>
              <TableCell>
                <Badge variant={e.leg === "export" ? "secondary" : "outline"}>
                  {e.leg === "export" ? t("trips.legExport") : t("trips.legImport")}
                </Badge>
              </TableCell>
              <TableCell>{e.qty}</TableCell>
              <TableCell>{formatUsdWhole(e.gross)}</TableCell>
              <TableCell>{formatUsdWhole(e.cogs)}</TableCell>
              <TableCell className={e.margin < 0 ? "text-destructive" : ""}>{formatUsdWhole(e.margin)}</TableCell>
              <TableCell className="text-right">
                <span className="inline-flex items-center gap-0.5">
                  <Button variant="ghost" size="icon" className="size-7" disabled={saleEdit.saving}
                    title={isLot ? t("trips.editLot") : t("trips.editSale")}
                    onClick={(ev) => { ev.stopPropagation(); if (isLot) saleEdit.openEditLot(e.items); else saleEdit.openEdit(e.items[0]); }}>
                    <Pencil className="size-4" />
                  </Button>
                  {e.sale_group != null && (
                    <ReceiptsDialog ownerType={`sale:${e.game}`} ownerId={e.sale_group} />
                  )}
                </span>
              </TableCell>
            </TableRow>
            {isLot && open && e.items.map((s) => (
              <TableRow key={s.key} className="bg-muted/30 text-xs text-muted-foreground">
                <TableCell />
                <TableCell className="truncate max-w-[280px] pl-6">{s.name} ×{s.quantity}</TableCell>
                <TableCell />
                <TableCell>{s.quantity}</TableCell>
                <TableCell>{formatUsdWhole(Number(s.gross_usd))}</TableCell>
                <TableCell>{formatUsdWhole(Number(s.cogs_usd))}</TableCell>
                <TableCell className={Number(s.margin_usd) < 0 ? "text-destructive" : ""}>{formatUsdWhole(Number(s.margin_usd))}</TableCell>
                <TableCell />
              </TableRow>
            ))}
            </Fragment>
            );
          })}
          {events.length === 0 && !error && (
            <TableRow><TableCell colSpan={8} className="text-muted-foreground">{isLoading ? t("common.loading") : t("trips.empty")}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between gap-2">
        {events.length > 0 && (
          <p className="text-sm font-medium">
            {t("sales.totalSummary", { gross: formatUsdWhole(total.gross), margin: formatUsdWhole(total.margin) })}
          </p>
        )}
        {data?.truncated && (
          <Button variant="outline" size="sm" disabled={isLoading} onClick={() => setLimit((l) => l + PAGE)}>
            {t("common.loadMore")}
          </Button>
        )}
      </div>

      {saleEdit.dialogs}
    </div>
  );
}
