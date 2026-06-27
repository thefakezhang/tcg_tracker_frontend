"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Undo2, ImageOff, ChevronUp, ChevronDown, ChevronsUpDown, Loader2, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSaving } from "@/lib/use-saving";
import { useLanguage } from "../LanguageContext";
import { getCardDisplayName, cardMeta, cardVariant } from "../use-card-data";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGroup } from "@/components/ui/field";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";


// inventory_holdings_v rows now carry item_type + leg + sealed keys.
interface Holding {
  game: string; // 'pokemon' | 'mtg' | 'pokemon_sealed'
  item_type: "single" | "sealed";
  leg: string; // 'import' | 'export'
  card_id: number | null;
  product_id: number | null;
  name: string;
  set_code: string;
  card_number: string | null;
  misc_info: string | null;
  condition_id: number | null;
  psa_grade: number | null;
  sealed_condition: string | null;
  variant_edition: string | null;
  qty_on_hand: number;
  avg_cost_usd: number;
  total_cost_usd: number;
  imageUrl: string | null;
  englishName: string | null;
}

interface SaleRow {
  key: string;
  kind: "single" | "sealed";
  game: string;
  sale_id: number;
  card_id: number | null;
  product_id: number | null;
  condition_id: number | null;
  psa_grade: number | null;
  sealed_condition: string | null;
  variant_edition: string | null;
  name: string;
  sold_at: string;
  quantity: number;
  gross_usd: number;
  cogs_usd: number;
  margin_usd: number;
  marginPct: number; // margin / gross * 100
  imageUrl: string | null;
  sale_group: number | null; // shared id for cards sold together as a lot
  reverted: boolean;         // an undo (negative) row already references this sale
  fees_usd: number;
  orig_currency: string;     // 'USD' (import) or native e.g. 'JPY' (export)
  proceeds_orig: number;
  fx_rate_used: number;
}

// A row of sales_ledger_v (migration 085).
type LedgerSaleRow = {
  sale_id: number; kind: "single" | "sealed"; game: string; sale_group: number | null;
  card_id: number | null; product_id: number | null; condition_id: number | null; psa_grade: number | null;
  sealed_condition: string | null; variant_edition: string | null;
  regional_name: string; set_code: string; card_number: string | null; misc_info: string | null; image_url: string | null;
  sold_at: string; quantity: number; gross_usd: number; fees_usd: number; cogs_usd: number; margin_usd: number;
  orig_currency: string; proceeds_orig: number; fx_rate_used: number; is_reverted: boolean;
};


export default function SalesTab({ tripId: _tripId }: { tripId: number }) {
  const { t } = useTranslation();
  const { saving, save } = useSaving();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [sel, setSel] = useState<Holding | null>(null);
  const [qty, setQty] = useState("1");
  const [currency, setCurrency] = useState("USD");
  const [proceeds, setProceeds] = useState("");
  const [fx, setFx] = useState("0.0067");
  const [fees, setFees] = useState("0");
  const [soldAt, setSoldAt] = useState(new Date().toISOString().slice(0, 10));
  // Edit-a-sale dialog (correct proceeds/fees/date without revert + re-record).
  const [editSel, setEditSel] = useState<SaleRow | null>(null);
  const [eQty, setEQty] = useState("1");
  const [eProceeds, setEProceeds] = useState("");
  const [eFees, setEFees] = useState("0");
  const [eFx, setEFx] = useState("1");
  const [eDate, setEDate] = useState("");
  // Edit-a-lot dialog: change the lot's TOTAL gross/fees and re-split across its
  // member cards (by their current cost share), without revert + re-record.
  const [eLotItems, setELotItems] = useState<SaleRow[] | null>(null);
  const [eLotGross, setELotGross] = useState("");
  const [eLotFees, setELotFees] = useState("0");
  const [eLotFx, setELotFx] = useState("1");
  const [eLotDate, setELotDate] = useState("");
  // Lot sale: pick several holdings, enter one total.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lotOpen, setLotOpen] = useState(false);
  const [lotGross, setLotGross] = useState("");
  const [lotFees, setLotFees] = useState("0");
  const [lotCurrency, setLotCurrency] = useState("USD");
  const [lotFx, setLotFx] = useState("0.0067");
  const [lotDate, setLotDate] = useState(new Date().toISOString().slice(0, 10));
  const [lotQty, setLotQty] = useState<Record<string, string>>({});
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [sortCol, setSortCol] = useState<"name" | "leg" | "qty" | "avg" | null>(null);
  const [hSearch, setHSearch] = useState("");
  const [hSortCol, setHSortCol] = useState<"name" | "date" | "qty" | "gross" | "cogs" | "margin" | "marginPct" | null>("date");
  const [sortAsc, setSortAsc] = useState(true);
  const [hSortAsc, setHSortAsc] = useState(false);
  const [groupBy, setGroupBy] = useState<"sale" | "card">("sale");
  const { language } = useLanguage();

  const fetchHoldings = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("inventory_holdings_v")
      .select("game, item_type, leg, card_id, product_id, name, set_code, card_number, misc_info, condition_id, psa_grade, sealed_condition, variant_edition, qty_on_hand, avg_cost_usd, total_cost_usd")
      .order("total_cost_usd", { ascending: false });
    const rows = ((data as Omit<Holding, "imageUrl" | "englishName">[]) ?? []).map((h) => ({ ...h, imageUrl: null as string | null, englishName: null as string | null }));
    // batch-fetch image_url (+ english_name for pokemon) for grid view
    const ids = (g: string, key: "card_id" | "product_id") => rows.filter((r) => r.game === g).map((r) => r[key]!).filter(Boolean);
    const fetchDefs = async (table: string, idCol: string, list: number[], cols: string) => {
      const m = new Map<number, { image_url: string | null; english_name?: string | null }>();
      if (list.length === 0) return m;
      const { data: defs } = await supabase.from(table).select(cols).in(idCol, list);
      for (const d of (defs as unknown as Record<string, unknown>[]) ?? []) m.set(d[idCol] as number, { image_url: (d.image_url as string) ?? null, english_name: (d.english_name as string) ?? null });
      return m;
    };
    const [pkm, mtg, sealed] = await Promise.all([
      fetchDefs("pokemon_card_definitions", "card_id", ids("pokemon", "card_id"), "card_id, image_url, english_name"),
      fetchDefs("mtg_card_definitions_v", "card_id", ids("mtg", "card_id"), "card_id, image_url"),
      fetchDefs("pokemon_sealed_products", "product_id", ids("pokemon_sealed", "product_id"), "product_id, image_url"),
    ]);
    for (const r of rows) {
      const hit = r.game === "pokemon" ? pkm.get(r.card_id!) : r.game === "mtg" ? mtg.get(r.card_id!) : sealed.get(r.product_id!);
      if (hit) { r.imageUrl = hit.image_url; r.englishName = hit.english_name ?? null; }
    }
    setHoldings(rows);
  }, []);

  // History reads from sales_ledger_v (085) — one query that resolves name, the
  // real leg, the reverted flag, and exposes card_id/product_id. Replaces the
  // old 3-table + joins assembly. Reverted sales are dropped (revert undoes them).
  const fetchSales = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("sales_ledger_v")
      .select("sale_id, kind, game, sale_group, card_id, product_id, condition_id, psa_grade, sealed_condition, variant_edition, regional_name, set_code, card_number, misc_info, image_url, sold_at, quantity, gross_usd, fees_usd, cogs_usd, margin_usd, orig_currency, proceeds_orig, fx_rate_used, is_reverted")
      .order("sold_at", { ascending: false }).limit(300);
    if (error) { setSales([]); return; }
    const rows = (data as LedgerSaleRow[]) ?? [];
    const live: SaleRow[] = rows
      .filter((r) => !r.is_reverted)
      .map((r) => ({
        key: `${r.game}-${r.sale_id}`, kind: r.kind, game: r.game, sale_id: r.sale_id,
        card_id: r.card_id, product_id: r.product_id, condition_id: r.condition_id, psa_grade: r.psa_grade,
        sealed_condition: r.sealed_condition, variant_edition: r.variant_edition,
        name: `${r.regional_name} · ${cardMeta(r.set_code, r.card_number, r.misc_info)}`.trim(),
        sold_at: r.sold_at, quantity: r.quantity,
        gross_usd: r.gross_usd, cogs_usd: r.cogs_usd, margin_usd: r.margin_usd,
        marginPct: r.gross_usd ? Math.round((r.margin_usd / r.gross_usd) * 1000) / 10 : 0,
        imageUrl: r.image_url, sale_group: r.sale_group, reverted: false,
        fees_usd: r.fees_usd, orig_currency: r.orig_currency, proceeds_orig: r.proceeds_orig, fx_rate_used: r.fx_rate_used,
      }));
    live.sort((a, b) => (a.sold_at < b.sold_at ? 1 : -1));
    setSales(live);
  }, []);

  useEffect(() => { fetchHoldings(); fetchSales(); }, [fetchHoldings, fetchSales]);

  function openSale(h: Holding) {
    setSel(h);
    setQty("1"); setProceeds(""); setFees("0");
    setCurrency(h.leg === "export" ? "JPY" : "USD");
  }

  async function recordSale() {
    if (!sel) return;
    const supabase = createClient();
    const isExport = sel.leg === "export";
    const native = isExport && currency.toUpperCase() !== "USD";
    const grossUsd = native ? Math.round(Number(proceeds) * Number(fx) * 100) / 100 : Number(proceeds);
    const common = {
      p_quantity: Number(qty), p_gross_usd: native ? 0 : grossUsd, p_fees_usd: Number(fees) || 0,
      p_sold_at: soldAt, p_leg: sel.leg,
      p_orig_currency: native ? currency.toUpperCase() : null,
      p_proceeds_orig: native ? Number(proceeds) : null,
      p_fx_rate: native ? Number(fx) : 1,
    };
    const ok = await save(() => sel.item_type === "sealed"
      ? supabase.rpc("record_sealed_sale", {
          p_product_id: sel.product_id, p_sealed_condition: sel.sealed_condition,
          p_variant_edition: sel.variant_edition, ...common,
        })
      : supabase.rpc("record_sale", {
          p_game: sel.game, p_card_id: sel.card_id, p_condition_id: sel.condition_id,
          p_psa_grade: sel.psa_grade ?? 0, ...common,
        }));
    if (!ok) return;
    setSel(null);
    await fetchHoldings(); await fetchSales();
  }

  // One reversal RPC. Caller is responsible for skipping already-reverted
  // sales; the backend (unique index on reverses_sale_id) is the hard guard.
  function reverseOne(s: SaleRow) {
    const supabase = createClient();
    const common = {
      p_quantity: -Math.abs(s.quantity), p_gross_usd: 0, p_fees_usd: 0,
      p_sold_at: new Date().toISOString().slice(0, 10), p_reverses_sale_id: s.sale_id,
    };
    return s.kind === "sealed"
      ? supabase.rpc("record_sealed_sale", {
          p_product_id: s.product_id, p_sealed_condition: s.sealed_condition, p_variant_edition: s.variant_edition, ...common,
        })
      : supabase.rpc("record_sale", {
          p_game: s.game, p_card_id: s.card_id, p_condition_id: s.condition_id, p_psa_grade: s.psa_grade ?? 0, ...common,
        });
  }

  async function voidSale(s: SaleRow) {
    if (s.reverted || saving) return;
    const ok = await save(() => reverseOne(s));
    if (!ok) return;
    await fetchHoldings(); await fetchSales();
  }

  // Revert every not-yet-reverted line of a lot in one click (sequentially, in
  // a single saving session so the button stays disabled the whole time).
  async function revertGroup(items: SaleRow[]) {
    if (saving) return;
    const todo = items.filter((i) => !i.reverted);
    if (todo.length === 0) return;
    const ok = await save(async () => {
      for (const it of todo) {
        const { error } = await reverseOne(it);
        if (error) return { error };
      }
      return { error: null };
    });
    if (!ok) return;
    await fetchHoldings(); await fetchSales();
  }

  function openEdit(s: SaleRow) {
    const isNative = !!s.orig_currency && s.orig_currency.toUpperCase() !== "USD";
    setEditSel(s);
    setEQty(String(s.quantity));
    setEProceeds(String(isNative ? s.proceeds_orig : s.gross_usd));
    setEFees(String(s.fees_usd));
    setEFx(String(s.fx_rate_used || 1));
    setEDate(s.sold_at);
  }

  // Edit a confirmed sale in place (no revert + re-record). Editing quantity
  // re-runs FIFO (edit_sale restores the old cost layers and re-consumes for the
  // new qty), so COGS is recomputed.
  async function editSale() {
    if (!editSel || saving) return;
    const s = editSel;
    const supabase = createClient();
    const isNative = !!s.orig_currency && s.orig_currency.toUpperCase() !== "USD";
    const grossUsd = isNative ? Math.round(Number(eProceeds) * Number(eFx) * 100) / 100 : Number(eProceeds);
    const common = {
      p_quantity: Math.max(1, Math.floor(Number(eQty)) || 1),
      p_gross_usd: isNative ? 0 : grossUsd, p_fees_usd: Number(eFees) || 0, p_sold_at: eDate,
      p_orig_currency: isNative ? s.orig_currency : null,
      p_proceeds_orig: isNative ? Number(eProceeds) : null,
      p_fx_rate: isNative ? Number(eFx) : 1,
    };
    const ok = await save(() => s.kind === "sealed"
      ? supabase.rpc("edit_sealed_sale", { p_sale_id: s.sale_id, ...common })
      : supabase.rpc("edit_sale", { p_game: s.game, p_sale_id: s.sale_id, ...common }));
    if (!ok) return;
    setEditSel(null);
    await fetchHoldings(); await fetchSales();
  }
  const eNative = !!editSel?.orig_currency && editSel.orig_currency.toUpperCase() !== "USD";

  const eLotNative = !!eLotItems?.[0]?.orig_currency && eLotItems[0].orig_currency.toUpperCase() !== "USD";
  function openEditLot(items: SaleRow[]) {
    const native = !!items[0]?.orig_currency && items[0].orig_currency.toUpperCase() !== "USD";
    setELotItems(items);
    setELotGross(String(native ? items.reduce((a, s) => a + Number(s.proceeds_orig), 0) : items.reduce((a, s) => a + Number(s.gross_usd), 0)));
    setELotFees(String(items.reduce((a, s) => a + Number(s.fees_usd), 0)));
    setELotFx(String(items[0]?.fx_rate_used || 1));
    setELotDate(items[0]?.sold_at ?? new Date().toISOString().slice(0, 10));
  }
  // Re-split the new lot total + fees across the members by their CURRENT cost
  // share (gross → cogs → even fallback) and edit each member in place. Each
  // edit_sale re-runs FIFO for the unchanged qty, so COGS is stable and only the
  // revenue/fees re-allocate. Sequential (no lot-level RPC); stops on first error.
  async function editLotSale() {
    if (!eLotItems || saving) return;
    const items = eLotItems;
    let weights = items.map((s) => Number(s.gross_usd));
    if (weights.reduce((a, b) => a + b, 0) <= 0) weights = items.map((s) => Number(s.cogs_usd));
    const grossAlloc = allocate(Number(eLotGross), weights);
    const feesAlloc = allocate(Number(eLotFees) || 0, weights);
    const supabase = createClient();
    const ok = await save(async () => {
      for (let i = 0; i < items.length; i++) {
        const s = items[i];
        const common = {
          p_quantity: s.quantity,
          p_gross_usd: eLotNative ? 0 : grossAlloc[i],
          p_fees_usd: feesAlloc[i], p_sold_at: eLotDate,
          p_orig_currency: eLotNative ? s.orig_currency : null,
          p_proceeds_orig: eLotNative ? grossAlloc[i] : null,
          p_fx_rate: eLotNative ? Number(eLotFx) : 1,
        };
        const { error } = await (s.kind === "sealed"
          ? supabase.rpc("edit_sealed_sale", { p_sale_id: s.sale_id, ...common })
          : supabase.rpc("edit_sale", { p_game: s.game, p_sale_id: s.sale_id, ...common }));
        if (error) throw error;
      }
    });
    if (!ok) return;
    setELotItems(null);
    await fetchHoldings(); await fetchSales();
  }

  const native = sel?.leg === "export" && currency.toUpperCase() !== "USD";

  // ---- lot sale ----
  const holdingKey = (h: Holding) =>
    `${h.game}-${h.card_id ?? h.product_id}-${h.condition_id ?? h.sealed_condition}-${h.psa_grade ?? h.variant_edition}-${h.leg}`;
  const selectedHoldings = holdings.filter((h) => selected.has(holdingKey(h)));
  const selectedLeg = selectedHoldings[0]?.leg ?? null;
  const label = (h: Holding) => getCardDisplayName({ regional_name: h.name, english_name: h.englishName }, language);
  const qtyOf = (h: Holding) => Math.max(1, Math.min(h.qty_on_hand, Math.floor(Number(lotQty[holdingKey(h)]) || h.qty_on_hand)));

  function setSort(col: "name" | "leg" | "qty" | "avg") {
    if (sortCol === col) setSortAsc((a) => !a);
    else { setSortCol(col); setSortAsc(true); }
  }
  const sortHead = (col: "name" | "leg" | "qty" | "avg", lbl: string, className?: string) => (
    <TableHead className={className}>
      <button className="flex items-center gap-1 hover:text-foreground" onClick={() => setSort(col)}>
        {lbl}
        {sortCol === col
          ? (sortAsc ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />)
          : <ChevronsUpDown className="size-3.5 opacity-40" />}
      </button>
    </TableHead>
  );
  const sorted = useMemo(() => {
    if (!sortCol) return holdings;
    const dir = sortAsc ? 1 : -1;
    const val = (h: Holding): string | number =>
      sortCol === "name" ? getCardDisplayName({ regional_name: h.name, english_name: h.englishName }, language).toLowerCase()
      : sortCol === "leg" ? h.leg
      : sortCol === "qty" ? h.qty_on_hand
      : Number(h.avg_cost_usd);
    return [...holdings].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  }, [holdings, sortCol, sortAsc, language]);

  type HCol = "name" | "date" | "qty" | "gross" | "cogs" | "margin" | "marginPct";
  function setHSort(col: HCol) {
    if (hSortCol === col) setHSortAsc((a) => !a);
    else { setHSortCol(col); setHSortAsc(true); }
  }
  const hHead = (col: HCol, lbl: string, className?: string) => (
    <TableHead className={className}>
      <button className="flex items-center gap-1 hover:text-foreground" onClick={() => setHSort(col)}>
        {lbl}
        {hSortCol === col
          ? (hSortAsc ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />)
          : <ChevronsUpDown className="size-3.5 opacity-40" />}
      </button>
    </TableHead>
  );
  const sortedSales = useMemo(() => {
    const qy = hSearch.trim().toLowerCase();
    const base = qy ? sales.filter((s) => s.name.toLowerCase().includes(qy)) : sales;
    if (!hSortCol) return base;
    const dir = hSortAsc ? 1 : -1;
    const val = (s: SaleRow): string | number =>
      hSortCol === "name" ? s.name.toLowerCase()
      : hSortCol === "date" ? s.sold_at
      : hSortCol === "qty" ? s.quantity
      : hSortCol === "gross" ? Number(s.gross_usd)
      : hSortCol === "cogs" ? Number(s.cogs_usd)
      : hSortCol === "margin" ? Number(s.margin_usd)
      : Number(s.marginPct);
    return [...base].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  }, [sales, hSortCol, hSortAsc, hSearch]);

  // Group sales into events: a lot (shared sale_group) collapses to one row;
  // singles are their own event. Preserves the sorted order via first-seen.
  type SaleEvent = {
    gid: string; items: SaleRow[]; sold_at: string;
    qty: number; gross: number; cogs: number; margin: number; marginPct: number;
    reverted: boolean; isLot: boolean;
  };
  const saleEvents = useMemo<SaleEvent[]>(() => {
    const map = new Map<string, SaleRow[]>();
    for (const s of sortedSales) {
      const gid = s.sale_group != null ? `g${s.sale_group}` : `s${s.key}`;
      const arr = map.get(gid);
      if (arr) arr.push(s); else map.set(gid, [s]);
    }
    return [...map.entries()].map(([gid, items]) => {
      const gross = items.reduce((a, i) => a + Number(i.gross_usd), 0);
      const margin = items.reduce((a, i) => a + Number(i.margin_usd), 0);
      return {
        gid, items, sold_at: items[0].sold_at,
        qty: items.reduce((a, i) => a + i.quantity, 0),
        gross, cogs: items.reduce((a, i) => a + Number(i.cogs_usd), 0), margin,
        marginPct: gross ? Math.round((margin / gross) * 1000) / 10 : 0,
        reverted: items.every((i) => i.reverted),
        isLot: items.length > 1,
      };
    });
  }, [sortedSales]);

  const voidButton = (s: SaleRow) => {
    if (s.reverted) return <span className="text-xs text-muted-foreground">{t("trips.reverted")}</span>;
    if (s.quantity <= 0) return null;
    return (
      <span className="flex items-center gap-0.5">
      <Button variant="ghost" size="icon" className="size-7" disabled={saving} onClick={() => openEdit(s)} title={t("trips.editSale")}>
        <Pencil className="size-4" />
      </Button>
      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="ghost" size="icon" className="size-7" disabled={saving} />}><Undo2 className="size-4" /></AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("trips.void")}</AlertDialogTitle>
            <AlertDialogDescription>{t("trips.voidConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("trips.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={() => voidSale(s)}>{t("trips.void")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </span>
    );
  };

  function toggle(h: Holding) {
    const k = holdingKey(h);
    setSelected((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }
  function openLot() {
    const q: Record<string, string> = {};
    for (const h of selectedHoldings) q[holdingKey(h)] = String(h.qty_on_hand);
    setLotQty(q);
    setLotGross(""); setLotFees("0"); setLotDate(new Date().toISOString().slice(0, 10));
    setLotCurrency(selectedLeg === "export" ? "JPY" : "USD"); setLotFx("0.0067");
    setLotOpen(true);
  }

  // Split a total across items by weight, exact to the cent (largest remainder).
  function allocate(total: number, weights: number[]): number[] {
    const cents = Math.round((Number(total) || 0) * 100);
    let ws = weights, tw = ws.reduce((a, b) => a + b, 0);
    if (tw <= 0) { ws = weights.map(() => 1); tw = ws.length; }
    const raw = ws.map((w) => (cents * w) / tw);
    const base = raw.map(Math.floor);
    const rem = cents - base.reduce((a, b) => a + b, 0);
    const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < rem; k++) base[order[k].i]++;
    return base.map((c) => c / 100);
  }

  async function recordLotSale() {
    const items = selectedHoldings;
    if (items.length === 0) return;
    const supabase = createClient();
    const weights = items.map((h) => Number(h.avg_cost_usd) * qtyOf(h));
    const grossAlloc = allocate(Number(lotGross), weights);
    const feesAlloc = allocate(Number(lotFees) || 0, weights);
    const isNative = selectedLeg === "export" && lotCurrency.toUpperCase() !== "USD";
    const payload = items.map((h, idx) => ({
      kind: h.item_type, game: h.game, card_id: h.card_id, condition_id: h.condition_id, psa_grade: h.psa_grade ?? 0,
      product_id: h.product_id, sealed_condition: h.sealed_condition, variant_edition: h.variant_edition,
      quantity: qtyOf(h), gross: grossAlloc[idx], fees: feesAlloc[idx],
    }));
    const ok = await save(() => supabase.rpc("record_lot_sale", {
      p_items: payload, p_sold_at: lotDate, p_leg: selectedLeg,
      p_orig_currency: isNative ? lotCurrency.toUpperCase() : null,
      p_fx_rate: isNative ? Number(lotFx) : 1,
    }));
    if (!ok) return;
    setLotOpen(false); setSelected(new Set());
    await fetchHoldings(); await fetchSales();
  }
  const lotNative = selectedLeg === "export" && lotCurrency.toUpperCase() !== "USD";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t("trips.recordSale")}</h2>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button size="sm" onClick={openLot}>{t("trips.sellLot", { n: selected.size })}</Button>
          )}
          <div className="flex items-center gap-1">
            <select value={sortCol ?? ""} onChange={(e) => setSortCol((e.target.value || null) as typeof sortCol)}
              className="h-8 rounded-md border bg-background px-2 text-xs" aria-label={t("trips.sortBy")}>
              <option value="">{t("trips.sortBy")}…</option>
              <option value="name">{t("trips.item")}</option>
              <option value="leg">{t("trips.leg")}</option>
              <option value="qty">{t("trips.qty")}</option>
              <option value="avg">{t("trips.avgCost")}</option>
            </select>
            <Button variant="outline" size="icon" className="size-8" onClick={() => setSortAsc((a) => !a)} aria-label={t("trips.sortBy")}>
              {sortAsc ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </Button>
          </div>
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(String(v) as "list" | "grid")}>
            <TabsList>
              <TabsTrigger value="list">{t("cardBrowser.list")}</TabsTrigger>
              <TabsTrigger value="grid">{t("cardBrowser.grid")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {viewMode === "grid" ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {sorted.map((h) => {
            const disabled = selectedLeg !== null && h.leg !== selectedLeg;
            return (
              <Card key={holdingKey(h)} size="sm" className={`gap-0 overflow-hidden !py-0 ${selected.has(holdingKey(h)) ? "ring-2 ring-primary" : ""}`}>
                <div className="relative">
                  {h.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={h.imageUrl} alt={label(h)} loading="lazy" className="aspect-[5/7] w-full object-cover" />
                  ) : (
                    <div className="flex aspect-[5/7] w-full items-center justify-center bg-muted"><ImageOff className="size-8 text-muted-foreground" /></div>
                  )}
                  <input type="checkbox" checked={selected.has(holdingKey(h))} disabled={disabled}
                    onChange={() => toggle(h)} title={t("trips.sellLotHint")} className="absolute left-1 top-1 size-4" />
                </div>
                <CardContent className="space-y-1 p-2">
                  <div className="truncate text-xs font-medium">{label(h)}</div>
                  {h.item_type !== "sealed" && <div className="truncate text-[10px] text-muted-foreground">{cardMeta(h.set_code, h.card_number, h.misc_info)}</div>}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="text-[10px]">{t(h.leg === "export" ? "trips.legExport" : "trips.legImport")}</Badge>
                    <span className="truncate">{h.item_type === "sealed" ? `${h.sealed_condition}/${h.variant_edition}` : h.psa_grade ? `PSA ${h.psa_grade}` : ""}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs"><span>×{h.qty_on_hand}</span><span>${h.avg_cost_usd}</span></div>
                  <Button size="sm" variant="outline" className="h-6 w-full" onClick={() => openSale(h)}>{t("trips.recordSale")}</Button>
                </CardContent>
              </Card>
            );
          })}
          {holdings.length === 0 && <p className="col-span-full text-sm text-muted-foreground">{t("trips.empty")}</p>}
        </div>
      ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            {sortHead("name", t("trips.item"))}
            {sortHead("leg", t("trips.leg"), "w-16")}
            {sortHead("qty", t("trips.qty"), "w-20")}
            {sortHead("avg", t("trips.avgCost"), "w-24")}
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((h) => (
            <TableRow key={holdingKey(h)}>
              <TableCell>
                <input type="checkbox" checked={selected.has(holdingKey(h))}
                  disabled={selectedLeg !== null && h.leg !== selectedLeg}
                  onChange={() => toggle(h)} title={t("trips.sellLotHint")} />
              </TableCell>
              <TableCell className="truncate max-w-[280px]">
                {label(h)} <span className="text-muted-foreground">· {cardMeta(h.set_code, h.card_number, h.misc_info)}</span>
                {h.item_type === "sealed" && <span className="text-muted-foreground"> ({h.sealed_condition}/{h.variant_edition})</span>}
                {h.psa_grade ? <span className="text-muted-foreground"> PSA {h.psa_grade}</span> : ""}
              </TableCell>
              <TableCell><Badge variant="secondary" className="text-[10px]">{t(h.leg === "export" ? "trips.legExport" : "trips.legImport")}</Badge></TableCell>
              <TableCell>{h.qty_on_hand}</TableCell>
              <TableCell>${h.avg_cost_usd}</TableCell>
              <TableCell>
                <Button size="sm" variant="outline" onClick={() => openSale(h)}>{t("trips.recordSale")}</Button>
              </TableCell>
            </TableRow>
          ))}
          {holdings.length === 0 && (
            <TableRow><TableCell colSpan={6} className="text-muted-foreground">{t("trips.empty")}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("trips.salesHistory")}</h3>
        <div className="flex items-center gap-2">
          <Input value={hSearch} onChange={(e) => setHSearch(e.target.value)}
            placeholder={t("sales.searchPlaceholder")} className="h-8 w-44" />
          <Tabs value={groupBy} onValueChange={(v) => setGroupBy(String(v) as "sale" | "card")}>
            <TabsList>
              <TabsTrigger value="sale">{t("trips.bySale")}</TabsTrigger>
              <TabsTrigger value="card">{t("trips.byCard")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-1">
            <select value={hSortCol ?? "date"} onChange={(e) => setHSortCol(e.target.value as HCol)}
              className="h-8 rounded-md border bg-background px-2 text-xs" aria-label={t("trips.sortBy")}>
              <option value="date">{t("trips.month")}</option>
              <option value="name">{t("trips.item")}</option>
              <option value="qty">{t("trips.qty")}</option>
              <option value="gross">{t("trips.saleGross")}</option>
              <option value="cogs">{t("trips.saleCogs")}</option>
              <option value="margin">{t("trips.saleMargin")}</option>
              <option value="marginPct">{t("trips.saleMarginPct")}</option>
            </select>
            <Button variant="outline" size="icon" className="size-8" onClick={() => setHSortAsc((a) => !a)} aria-label={t("trips.sortBy")}>
              {hSortAsc ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </Button>
          </div>
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(String(v) as "list" | "grid")}>
            <TabsList>
              <TabsTrigger value="list">{t("cardBrowser.list")}</TabsTrigger>
              <TabsTrigger value="grid">{t("cardBrowser.grid")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      {groupBy === "sale" && viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {saleEvents.map((ev) => (
            <Card key={ev.gid} size="sm" className={`gap-0 overflow-hidden ${ev.reverted ? "opacity-50" : ""}`}>
              <div className="flex gap-2 p-2">
                {ev.items[0].imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ev.items[0].imageUrl} alt="" loading="lazy" className="aspect-[5/7] w-14 shrink-0 rounded object-cover" />
                ) : (
                  <div className="flex aspect-[5/7] w-14 shrink-0 items-center justify-center rounded bg-muted"><ImageOff className="size-6 text-muted-foreground" /></div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 truncate text-sm font-medium">
                    {ev.isLot ? <Badge variant="secondary" className="text-[10px]">{t("trips.lotItems", { n: ev.items.length })}</Badge> : <span className="truncate">{ev.items[0].name}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{ev.sold_at} · ×{ev.qty}</div>
                  <div className="mt-1 grid grid-cols-3 gap-1 text-xs tabular-nums">
                    <span title={t("trips.saleGross")}>${ev.gross.toFixed(0)}</span>
                    <span className="text-muted-foreground" title={t("trips.saleCogs")}>${ev.cogs.toFixed(0)}</span>
                    <span className={ev.margin < 0 ? "text-destructive" : ""} title={t("trips.saleMargin")}>${ev.margin.toFixed(0)} · {ev.marginPct}%</span>
                  </div>
                  {!ev.reverted && (
                    <Button variant="ghost" size="sm" className="mt-1 h-6 px-1 text-xs" disabled={saving}
                      onClick={() => ev.isLot ? openEditLot(ev.items) : openEdit(ev.items[0])}>
                      <Pencil className="size-3 mr-1" />{ev.isLot ? t("trips.editLot") : t("trips.editSale")}
                    </Button>
                  )}
                </div>
              </div>
              {ev.isLot && (
                <div className="max-h-28 space-y-0.5 overflow-auto border-t px-2 py-1">
                  {ev.items.map((s) => (
                    <div key={s.key} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate text-muted-foreground">{s.name} ×{s.quantity}</span>
                      <span className="flex shrink-0 items-center gap-2 tabular-nums">
                        <span>${s.gross_usd}</span>
                        <span className="text-muted-foreground">${s.cogs_usd}</span>
                        <span className={s.margin_usd < 0 ? "text-destructive" : ""}>${s.margin_usd}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
          {saleEvents.length === 0 && <p className="col-span-full text-sm text-muted-foreground">{t("trips.empty")}</p>}
        </div>
      ) : groupBy === "sale" ? (
        <div className="space-y-2">
          {saleEvents.map((ev) => (
            <Card key={ev.gid} size="sm">
              <CardContent className="space-y-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {ev.isLot ? t("trips.lotItems", { n: ev.items.length }) : ev.items[0].name}
                    </div>
                    <div className="text-xs text-muted-foreground">{ev.sold_at} · ×{ev.qty}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-sm">
                    <span className="tabular-nums">${ev.gross.toFixed(0)}</span>
                    <span className={`tabular-nums ${ev.margin < 0 ? "text-destructive" : ""}`}>${ev.margin.toFixed(0)} · {ev.marginPct}%</span>
                    {ev.reverted ? (
                      <span className="text-xs text-muted-foreground">{t("trips.reverted")}</span>
                    ) : (
                      <>
                      <Button variant="ghost" size="icon" className="size-7" disabled={saving}
                        onClick={() => ev.isLot ? openEditLot(ev.items) : openEdit(ev.items[0])}
                        title={ev.isLot ? t("trips.editLot") : t("trips.editSale")}>
                        <Pencil className="size-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger render={<Button variant="ghost" size="sm" disabled={saving} />}>
                          <Undo2 className="size-4 mr-1" />{t("trips.revertLot")}
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("trips.revertLot")}</AlertDialogTitle>
                            <AlertDialogDescription>{t("trips.revertLotConfirm")}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("trips.cancel")}</AlertDialogCancel>
                            <AlertDialogAction disabled={saving} onClick={() => revertGroup(ev.items)}>{t("trips.revertLot")}</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      </>
                    )}
                  </div>
                </div>
                {ev.isLot && (
                  <div className="space-y-1 border-t pt-2">
                    <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <span>{t("trips.item")}</span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="w-14 text-right">{t("trips.saleGross")}</span>
                        <span className="w-14 text-right">{t("trips.saleCogs")}</span>
                        <span className="w-20 text-right">{t("trips.saleMargin")}</span>
                        <span className="w-7" />
                      </span>
                    </div>
                    {ev.items.map((s) => (
                      <div key={s.key} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-muted-foreground">{s.name} ×{s.quantity}</span>
                        <span className="flex shrink-0 items-center gap-3 tabular-nums">
                          <span className="w-14 text-right">${s.gross_usd}</span>
                          <span className="w-14 text-right text-muted-foreground">${s.cogs_usd}</span>
                          <span className={`w-20 text-right ${s.margin_usd < 0 ? "text-destructive" : ""}`}>${s.margin_usd} · {s.marginPct}%</span>
                          {voidButton(s)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {saleEvents.length === 0 && <p className="text-sm text-muted-foreground">{t("trips.empty")}</p>}
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {sortedSales.map((s) => (
            <Card key={s.key} size="sm" className="gap-0 overflow-hidden !py-0">
              {s.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.imageUrl} alt={s.name} loading="lazy" className="aspect-[5/7] w-full object-cover" />
              ) : (
                <div className="flex aspect-[5/7] w-full items-center justify-center bg-muted"><ImageOff className="size-8 text-muted-foreground" /></div>
              )}
              <CardContent className="space-y-1 p-2">
                <div className="truncate text-xs font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.sold_at} · ×{s.quantity}</div>
                <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
                  <span title={t("trips.saleGross")}>${s.gross_usd}</span>
                  <span title={t("trips.saleCogs")}>−${s.cogs_usd}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className={s.margin_usd < 0 ? "text-destructive" : ""}>${s.margin_usd} · {s.marginPct}%</span>
                  {voidButton(s)}
                </div>
              </CardContent>
            </Card>
          ))}
          {sortedSales.length === 0 && <p className="col-span-full text-sm text-muted-foreground">{t("trips.empty")}</p>}
        </div>
      ) : (
      <Table>
        <TableHeader>
          <TableRow>
            {hHead("name", t("trips.item"))}
            {hHead("date", t("trips.month"), "w-24")}
            {hHead("qty", t("trips.qty"), "w-12")}
            {hHead("gross", t("trips.saleGross"), "w-20")}
            {hHead("cogs", t("trips.saleCogs"), "w-20")}
            {hHead("margin", t("trips.saleMargin"), "w-20")}
            {hHead("marginPct", t("trips.saleMarginPct"), "w-20")}
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedSales.map((s) => (
            <TableRow key={s.key}>
              <TableCell className="truncate max-w-[240px]">{s.name}</TableCell>
              <TableCell>{s.sold_at}</TableCell>
              <TableCell>{s.quantity}</TableCell>
              <TableCell>${s.gross_usd}</TableCell>
              <TableCell>${s.cogs_usd}</TableCell>
              <TableCell className={s.margin_usd < 0 ? "text-destructive" : ""}>${s.margin_usd}</TableCell>
              <TableCell className={s.margin_usd < 0 ? "text-destructive" : ""}>{s.marginPct}%</TableCell>
              <TableCell>{voidButton(s)}</TableCell>
            </TableRow>
          ))}
          {sortedSales.length === 0 && (
            <TableRow><TableCell colSpan={8} className="text-muted-foreground">{t("trips.empty")}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
      )}

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{sel?.name}</DialogTitle></DialogHeader>
          <FieldGroup>
            <Field><Label>{t("trips.saleQty")}</Label>
              <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
            {sel?.leg === "export" && (
              <Field><Label>{t("trips.saleCurrency")}</Label>
                <Input value={currency} onChange={(e) => setCurrency(e.target.value)} /></Field>
            )}
            <Field><Label>{native ? t("trips.saleProceedsOrig") : t("trips.saleGross")}</Label>
              <Input type="number" value={proceeds} onChange={(e) => setProceeds(e.target.value)} autoFocus /></Field>
            {native && (
              <>
                <Field><Label>{t("trips.saleFx")}</Label>
                  <Input type="number" value={fx} onChange={(e) => setFx(e.target.value)} /></Field>
                <p className="text-xs text-muted-foreground">
                  {t("trips.usdComputed", { usd: (Number(proceeds) * Number(fx) || 0).toFixed(2) })}
                </p>
              </>
            )}
            <Field><Label>{t("trips.saleFees")}</Label>
              <Input type="number" value={fees} onChange={(e) => setFees(e.target.value)} /></Field>
            <Field><Label>{t("trips.month")}</Label>
              <Input type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)} /></Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSel(null)}>{t("trips.cancel")}</Button>
            <Button disabled={!proceeds || saving} onClick={recordSale}>{saving ? <Loader2 className="size-4 animate-spin" /> : t("trips.recordSale")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editSel} onOpenChange={(o) => !o && setEditSel(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t("trips.editSale")} · {editSel?.name}</DialogTitle></DialogHeader>
          <FieldGroup>
            <Field><Label>{t("trips.saleQty")}</Label>
              <Input type="number" min={1} value={eQty} onChange={(e) => setEQty(e.target.value)} /></Field>
            <Field><Label>{eNative ? t("trips.saleProceedsOrig") : t("trips.saleGross")}</Label>
              <Input type="number" value={eProceeds} onChange={(e) => setEProceeds(e.target.value)} autoFocus /></Field>
            {eNative && (
              <>
                <Field><Label>{t("trips.saleFx")}</Label>
                  <Input type="number" value={eFx} onChange={(e) => setEFx(e.target.value)} /></Field>
                <p className="text-xs text-muted-foreground">
                  {t("trips.usdComputed", { usd: (Number(eProceeds) * Number(eFx) || 0).toFixed(2) })}
                </p>
              </>
            )}
            <Field><Label>{t("trips.saleFees")}</Label>
              <Input type="number" value={eFees} onChange={(e) => setEFees(e.target.value)} /></Field>
            <Field><Label>{t("trips.month")}</Label>
              <Input type="date" value={eDate} onChange={(e) => setEDate(e.target.value)} /></Field>
            {Number(eQty) !== editSel?.quantity && (
              <p className="text-xs text-muted-foreground">{t("trips.editSaleQtyNote")}</p>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSel(null)}>{t("trips.cancel")}</Button>
            <Button disabled={!eProceeds || saving} onClick={editSale}>{saving ? <Loader2 className="size-4 animate-spin" /> : t("trips.saveChanges")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!eLotItems} onOpenChange={(o) => !o && setELotItems(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t("trips.editLot")} · {t("trips.lotItems", { n: eLotItems?.length ?? 0 })}</DialogTitle></DialogHeader>
          <FieldGroup>
            <Field><Label>{eLotNative ? t("trips.saleProceedsOrig") : t("trips.saleGross")}</Label>
              <Input type="number" value={eLotGross} onChange={(e) => setELotGross(e.target.value)} autoFocus /></Field>
            {eLotNative && (
              <>
                <Field><Label>{t("trips.saleFx")}</Label>
                  <Input type="number" value={eLotFx} onChange={(e) => setELotFx(e.target.value)} /></Field>
                <p className="text-xs text-muted-foreground">
                  {t("trips.usdComputed", { usd: (Number(eLotGross) * Number(eLotFx) || 0).toFixed(2) })}
                </p>
              </>
            )}
            <Field><Label>{t("trips.saleFees")}</Label>
              <Input type="number" value={eLotFees} onChange={(e) => setELotFees(e.target.value)} /></Field>
            <Field><Label>{t("trips.month")}</Label>
              <Input type="date" value={eLotDate} onChange={(e) => setELotDate(e.target.value)} /></Field>
            <p className="text-xs text-muted-foreground">{t("trips.editLotNote")}</p>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setELotItems(null)}>{t("trips.cancel")}</Button>
            <Button disabled={!eLotGross || saving} onClick={editLotSale}>{saving ? <Loader2 className="size-4 animate-spin" /> : t("trips.saveChanges")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lotOpen} onOpenChange={(o) => !o && setLotOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t("trips.lotSaleTitle", { n: selectedHoldings.length })}</DialogTitle></DialogHeader>
          <div className="max-h-44 space-y-1 overflow-auto rounded-md border p-1 text-sm">
            {selectedHoldings.map((h) => (
              <div key={holdingKey(h)} className="flex items-center gap-2 px-1 py-0.5">
                <span className="flex-1 truncate">{label(h)}{cardVariant(h.misc_info) ? ` · ${cardVariant(h.misc_info)}` : ""}{h.psa_grade ? ` · PSA ${h.psa_grade}` : ""}{h.item_type === "sealed" ? ` · ${h.sealed_condition}/${h.variant_edition}` : ""}</span>
                <Input type="number" min={1} max={h.qty_on_hand}
                  value={lotQty[holdingKey(h)] ?? String(h.qty_on_hand)}
                  onChange={(e) => setLotQty((p) => ({ ...p, [holdingKey(h)]: e.target.value }))}
                  className="h-7 w-16" />
                <span className="shrink-0 text-xs text-muted-foreground">/ {h.qty_on_hand}</span>
              </div>
            ))}
          </div>
          <FieldGroup>
            {selectedLeg === "export" && (
              <Field><Label>{t("trips.saleCurrency")}</Label>
                <Input value={lotCurrency} onChange={(e) => setLotCurrency(e.target.value)} /></Field>
            )}
            <Field><Label>{lotNative ? t("trips.saleProceedsOrig") : t("trips.lotProceeds")}</Label>
              <Input type="number" value={lotGross} onChange={(e) => setLotGross(e.target.value)} autoFocus /></Field>
            {lotNative && (
              <>
                <Field><Label>{t("trips.saleFx")}</Label>
                  <Input type="number" value={lotFx} onChange={(e) => setLotFx(e.target.value)} /></Field>
                <p className="text-xs text-muted-foreground">
                  {t("trips.usdComputed", { usd: (Number(lotGross) * Number(lotFx) || 0).toFixed(2) })}
                </p>
              </>
            )}
            <Field><Label>{t("trips.saleFees")}</Label>
              <Input type="number" value={lotFees} onChange={(e) => setLotFees(e.target.value)} /></Field>
            <Field><Label>{t("trips.month")}</Label>
              <Input type="date" value={lotDate} onChange={(e) => setLotDate(e.target.value)} /></Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLotOpen(false)}>{t("trips.cancel")}</Button>
            <Button disabled={!lotGross || saving} onClick={recordLotSale}>{saving ? <Loader2 className="size-4 animate-spin" /> : t("trips.recordSale")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
