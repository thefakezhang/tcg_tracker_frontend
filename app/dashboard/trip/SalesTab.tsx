"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Undo2, ImageOff, ChevronUp, ChevronDown, ChevronsUpDown, Loader2, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSaving } from "@/lib/use-saving";
import { useLanguage } from "../LanguageContext";
import { getCardDisplayName } from "../use-card-data";
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

type CardGame = "pokemon" | "mtg";

// inventory_holdings_v rows now carry item_type + leg + sealed keys.
interface Holding {
  game: string; // 'pokemon' | 'mtg' | 'pokemon_sealed'
  item_type: "single" | "sealed";
  leg: string; // 'import' | 'export'
  card_id: number | null;
  product_id: number | null;
  name: string;
  set_code: string;
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

const DEF_TABLE: Record<CardGame, string> = { pokemon: "pokemon_card_definitions", mtg: "mtg_card_definitions_v" };

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
  const [hSortCol, setHSortCol] = useState<"name" | "date" | "qty" | "gross" | "cogs" | "margin" | "marginPct" | null>("date");
  const [sortAsc, setSortAsc] = useState(true);
  const [hSortAsc, setHSortAsc] = useState(false);
  const [groupBy, setGroupBy] = useState<"sale" | "card">("sale");
  const { language } = useLanguage();

  const fetchHoldings = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("inventory_holdings_v")
      .select("game, item_type, leg, card_id, product_id, name, set_code, condition_id, psa_grade, sealed_condition, variant_edition, qty_on_hand, avg_cost_usd, total_cost_usd")
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

  const fetchSales = useCallback(async () => {
    const supabase = createClient();
    const out: SaleRow[] = [];
    // Keys of originals that already have an undo (negative) row referencing
    // them — so we can hide the revert button and never double-reverse.
    const revertedKeys = new Set<string>();
    // card sales
    for (const game of ["pokemon", "mtg"] as CardGame[]) {
      const { data } = await supabase
        .from(`${game}_sales`)
        .select("sale_id, card_id, condition_id, psa_grade, sold_at, quantity, gross_usd, cogs_usd, margin_usd, sale_group, reverses_sale_id, fees_usd, orig_currency, proceeds_orig, fx_rate_used")
        .order("sold_at", { ascending: false }).limit(100);
      const rows = (data as { sale_id: number; card_id: number; condition_id: number; psa_grade: number; sold_at: string; quantity: number; gross_usd: number; cogs_usd: number; margin_usd: number; sale_group: number | null; reverses_sale_id: number | null; fees_usd: number; orig_currency: string; proceeds_orig: number; fx_rate_used: number }[]) ?? [];
      // A negative row is an undo — record which original it cancels, then drop
      // it from the displayed history (it's an accounting artifact, not a sale).
      for (const r of rows) if (r.reverses_sale_id != null) revertedKeys.add(`${game}-${r.reverses_sale_id}`);
      const originals = rows.filter((r) => r.reverses_sale_id == null);
      if (originals.length === 0) continue;
      const { data: defs } = await supabase
        .from(DEF_TABLE[game]).select("card_id, regional_name, set_code, card_number, image_url").in("card_id", [...new Set(originals.map((r) => r.card_id))]);
      const nameMap = new Map<number, string>();
      const imgMap = new Map<number, string | null>();
      for (const d of (defs as { card_id: number; regional_name: string; set_code: string; card_number: string | null; image_url: string | null }[]) ?? []) {
        nameMap.set(d.card_id, `${d.regional_name} · ${d.set_code} ${d.card_number ?? ""}`.trim());
        imgMap.set(d.card_id, d.image_url);
      }
      for (const r of originals) out.push({
        key: `${game}-${r.sale_id}`, kind: "single", game, sale_id: r.sale_id, card_id: r.card_id,
        product_id: null, condition_id: r.condition_id, psa_grade: r.psa_grade, sealed_condition: null,
        variant_edition: null, name: nameMap.get(r.card_id) ?? `#${r.card_id}`, sold_at: r.sold_at,
        quantity: r.quantity, gross_usd: r.gross_usd, cogs_usd: r.cogs_usd, margin_usd: r.margin_usd,
        marginPct: r.gross_usd ? Math.round((r.margin_usd / r.gross_usd) * 1000) / 10 : 0,
        imageUrl: imgMap.get(r.card_id) ?? null, sale_group: r.sale_group, reverted: false,
        fees_usd: r.fees_usd, orig_currency: r.orig_currency, proceeds_orig: r.proceeds_orig, fx_rate_used: r.fx_rate_used,
      });
    }
    // sealed sales
    const { data: sdata } = await supabase
      .from("pokemon_sealed_sales")
      .select("sale_id, product_id, sealed_condition, variant_edition, sold_at, quantity, gross_usd, cogs_usd, margin_usd, sale_group, reverses_sale_id, fees_usd, orig_currency, proceeds_orig, fx_rate_used")
      .order("sold_at", { ascending: false }).limit(100);
    const srows = (sdata as { sale_id: number; product_id: number; sealed_condition: string; variant_edition: string; sold_at: string; quantity: number; gross_usd: number; cogs_usd: number; margin_usd: number; sale_group: number | null; reverses_sale_id: number | null; fees_usd: number; orig_currency: string; proceeds_orig: number; fx_rate_used: number }[]) ?? [];
    for (const r of srows) if (r.reverses_sale_id != null) revertedKeys.add(`sealed-${r.reverses_sale_id}`);
    const sorigs = srows.filter((r) => r.reverses_sale_id == null);
    if (sorigs.length > 0) {
      const { data: prods } = await supabase
        .from("pokemon_sealed_products").select("product_id, name, set_code, image_url").in("product_id", [...new Set(sorigs.map((r) => r.product_id))]);
      const pMap = new Map<number, string>();
      const pImg = new Map<number, string | null>();
      for (const p of (prods as { product_id: number; name: string; set_code: string; image_url: string | null }[]) ?? []) {
        pMap.set(p.product_id, `${p.name} · ${p.set_code}`); pImg.set(p.product_id, p.image_url);
      }
      for (const r of sorigs) out.push({
        key: `sealed-${r.sale_id}`, kind: "sealed", game: "pokemon_sealed", sale_id: r.sale_id, card_id: null,
        product_id: r.product_id, condition_id: null, psa_grade: null, sealed_condition: r.sealed_condition,
        variant_edition: r.variant_edition, name: pMap.get(r.product_id) ?? `#${r.product_id}`, sold_at: r.sold_at,
        quantity: r.quantity, gross_usd: r.gross_usd, cogs_usd: r.cogs_usd, margin_usd: r.margin_usd,
        marginPct: r.gross_usd ? Math.round((r.margin_usd / r.gross_usd) * 1000) / 10 : 0,
        imageUrl: pImg.get(r.product_id) ?? null, sale_group: r.sale_group, reverted: false,
        fees_usd: r.fees_usd, orig_currency: r.orig_currency, proceeds_orig: r.proceeds_orig, fx_rate_used: r.fx_rate_used,
      });
    }
    // Reverted sales drop out of the list entirely (a revert undoes the sale).
    const live = out.filter((o) => !revertedKeys.has(o.key));
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
    if (!hSortCol) return sales;
    const dir = hSortAsc ? 1 : -1;
    const val = (s: SaleRow): string | number =>
      hSortCol === "name" ? s.name.toLowerCase()
      : hSortCol === "date" ? s.sold_at
      : hSortCol === "qty" ? s.quantity
      : hSortCol === "gross" ? Number(s.gross_usd)
      : hSortCol === "cogs" ? Number(s.cogs_usd)
      : hSortCol === "margin" ? Number(s.margin_usd)
      : Number(s.marginPct);
    return [...sales].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  }, [sales, hSortCol, hSortAsc]);

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
              <TableCell className="truncate max-w-[260px]">
                {label(h)} · {h.set_code}
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
          {groupBy === "card" && (
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(String(v) as "list" | "grid")}>
              <TabsList>
                <TabsTrigger value="list">{t("cardBrowser.list")}</TabsTrigger>
                <TabsTrigger value="grid">{t("cardBrowser.grid")}</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>
      </div>
      {groupBy === "sale" ? (
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
                    )}
                  </div>
                </div>
                {ev.isLot && (
                  <div className="space-y-1 border-t pt-2">
                    {ev.items.map((s) => (
                      <div key={s.key} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-muted-foreground">{s.name} ×{s.quantity}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className={s.margin_usd < 0 ? "text-destructive" : ""}>${s.margin_usd}</span>
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

      <Dialog open={lotOpen} onOpenChange={(o) => !o && setLotOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t("trips.lotSaleTitle", { n: selectedHoldings.length })}</DialogTitle></DialogHeader>
          <div className="max-h-44 space-y-1 overflow-auto rounded-md border p-1 text-sm">
            {selectedHoldings.map((h) => (
              <div key={holdingKey(h)} className="flex items-center gap-2 px-1 py-0.5">
                <span className="flex-1 truncate">{label(h)}{h.psa_grade ? ` · PSA ${h.psa_grade}` : ""}{h.item_type === "sealed" ? ` · ${h.sealed_condition}/${h.variant_edition}` : ""}</span>
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
