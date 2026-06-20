"use client";

import { useCallback, useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
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
}

const DEF_TABLE: Record<CardGame, string> = { pokemon: "pokemon_card_definitions", mtg: "mtg_card_definitions_v" };

export default function SalesTab({ tripId: _tripId }: { tripId: number }) {
  const { t } = useTranslation();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [sel, setSel] = useState<Holding | null>(null);
  const [qty, setQty] = useState("1");
  const [currency, setCurrency] = useState("USD");
  const [proceeds, setProceeds] = useState("");
  const [fx, setFx] = useState("0.0067");
  const [fees, setFees] = useState("0");
  const [soldAt, setSoldAt] = useState(new Date().toISOString().slice(0, 10));
  // Lot sale: pick several holdings, enter one total.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lotOpen, setLotOpen] = useState(false);
  const [lotGross, setLotGross] = useState("");
  const [lotFees, setLotFees] = useState("0");
  const [lotCurrency, setLotCurrency] = useState("USD");
  const [lotFx, setLotFx] = useState("0.0067");
  const [lotDate, setLotDate] = useState(new Date().toISOString().slice(0, 10));

  const fetchHoldings = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("inventory_holdings_v")
      .select("game, item_type, leg, card_id, product_id, name, set_code, condition_id, psa_grade, sealed_condition, variant_edition, qty_on_hand, avg_cost_usd, total_cost_usd")
      .order("total_cost_usd", { ascending: false });
    setHoldings((data as Holding[]) ?? []);
  }, []);

  const fetchSales = useCallback(async () => {
    const supabase = createClient();
    const out: SaleRow[] = [];
    // card sales
    for (const game of ["pokemon", "mtg"] as CardGame[]) {
      const { data } = await supabase
        .from(`${game}_sales`)
        .select("sale_id, card_id, condition_id, psa_grade, sold_at, quantity, gross_usd, cogs_usd, margin_usd")
        .order("sold_at", { ascending: false }).limit(50);
      const rows = (data as { sale_id: number; card_id: number; condition_id: number; psa_grade: number; sold_at: string; quantity: number; gross_usd: number; cogs_usd: number; margin_usd: number }[]) ?? [];
      if (rows.length === 0) continue;
      const { data: defs } = await supabase
        .from(DEF_TABLE[game]).select("card_id, regional_name, set_code, card_number").in("card_id", [...new Set(rows.map((r) => r.card_id))]);
      const nameMap = new Map<number, string>();
      for (const d of (defs as { card_id: number; regional_name: string; set_code: string; card_number: string | null }[]) ?? []) {
        nameMap.set(d.card_id, `${d.regional_name} · ${d.set_code} ${d.card_number ?? ""}`.trim());
      }
      for (const r of rows) out.push({
        key: `${game}-${r.sale_id}`, kind: "single", game, sale_id: r.sale_id, card_id: r.card_id,
        product_id: null, condition_id: r.condition_id, psa_grade: r.psa_grade, sealed_condition: null,
        variant_edition: null, name: nameMap.get(r.card_id) ?? `#${r.card_id}`, sold_at: r.sold_at,
        quantity: r.quantity, gross_usd: r.gross_usd, cogs_usd: r.cogs_usd, margin_usd: r.margin_usd,
      });
    }
    // sealed sales
    const { data: sdata } = await supabase
      .from("pokemon_sealed_sales")
      .select("sale_id, product_id, sealed_condition, variant_edition, sold_at, quantity, gross_usd, cogs_usd, margin_usd")
      .order("sold_at", { ascending: false }).limit(50);
    const srows = (sdata as { sale_id: number; product_id: number; sealed_condition: string; variant_edition: string; sold_at: string; quantity: number; gross_usd: number; cogs_usd: number; margin_usd: number }[]) ?? [];
    if (srows.length > 0) {
      const { data: prods } = await supabase
        .from("pokemon_sealed_products").select("product_id, name, set_code").in("product_id", [...new Set(srows.map((r) => r.product_id))]);
      const pMap = new Map<number, string>();
      for (const p of (prods as { product_id: number; name: string; set_code: string }[]) ?? []) pMap.set(p.product_id, `${p.name} · ${p.set_code}`);
      for (const r of srows) out.push({
        key: `sealed-${r.sale_id}`, kind: "sealed", game: "pokemon_sealed", sale_id: r.sale_id, card_id: null,
        product_id: r.product_id, condition_id: null, psa_grade: null, sealed_condition: r.sealed_condition,
        variant_edition: r.variant_edition, name: pMap.get(r.product_id) ?? `#${r.product_id}`, sold_at: r.sold_at,
        quantity: r.quantity, gross_usd: r.gross_usd, cogs_usd: r.cogs_usd, margin_usd: r.margin_usd,
      });
    }
    out.sort((a, b) => (a.sold_at < b.sold_at ? 1 : -1));
    setSales(out);
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
    const { error } = sel.item_type === "sealed"
      ? await supabase.rpc("record_sealed_sale", {
          p_product_id: sel.product_id, p_sealed_condition: sel.sealed_condition,
          p_variant_edition: sel.variant_edition, ...common,
        })
      : await supabase.rpc("record_sale", {
          p_game: sel.game, p_card_id: sel.card_id, p_condition_id: sel.condition_id,
          p_psa_grade: sel.psa_grade ?? 0, ...common,
        });
    if (error) { alert(error.message); return; }
    setSel(null);
    await fetchHoldings(); await fetchSales();
  }

  async function voidSale(s: SaleRow) {
    const supabase = createClient();
    const common = {
      p_quantity: -Math.abs(s.quantity), p_gross_usd: 0, p_fees_usd: 0,
      p_sold_at: new Date().toISOString().slice(0, 10), p_reverses_sale_id: s.sale_id,
    };
    const { error } = s.kind === "sealed"
      ? await supabase.rpc("record_sealed_sale", {
          p_product_id: s.product_id, p_sealed_condition: s.sealed_condition, p_variant_edition: s.variant_edition, ...common,
        })
      : await supabase.rpc("record_sale", {
          p_game: s.game, p_card_id: s.card_id, p_condition_id: s.condition_id, p_psa_grade: s.psa_grade ?? 0, ...common,
        });
    if (error) { alert(error.message); return; }
    await fetchHoldings(); await fetchSales();
  }

  const native = sel?.leg === "export" && currency.toUpperCase() !== "USD";

  // ---- lot sale ----
  const holdingKey = (h: Holding) =>
    `${h.game}-${h.card_id ?? h.product_id}-${h.condition_id ?? h.sealed_condition}-${h.psa_grade ?? h.variant_edition}-${h.leg}`;
  const selectedHoldings = holdings.filter((h) => selected.has(holdingKey(h)));
  const selectedLeg = selectedHoldings[0]?.leg ?? null;

  function toggle(h: Holding) {
    const k = holdingKey(h);
    setSelected((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  }
  function openLot() {
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
    const weights = items.map((h) => Number(h.avg_cost_usd) * h.qty_on_hand);
    const grossAlloc = allocate(Number(lotGross), weights);
    const feesAlloc = allocate(Number(lotFees) || 0, weights);
    const isNative = selectedLeg === "export" && lotCurrency.toUpperCase() !== "USD";
    const payload = items.map((h, idx) => ({
      kind: h.item_type, game: h.game, card_id: h.card_id, condition_id: h.condition_id, psa_grade: h.psa_grade ?? 0,
      product_id: h.product_id, sealed_condition: h.sealed_condition, variant_edition: h.variant_edition,
      quantity: h.qty_on_hand, gross: grossAlloc[idx], fees: feesAlloc[idx],
    }));
    const { error } = await supabase.rpc("record_lot_sale", {
      p_items: payload, p_sold_at: lotDate, p_leg: selectedLeg,
      p_orig_currency: isNative ? lotCurrency.toUpperCase() : null,
      p_fx_rate: isNative ? Number(lotFx) : 1,
    });
    if (error) { alert(error.message); return; }
    setLotOpen(false); setSelected(new Set());
    await fetchHoldings(); await fetchSales();
  }
  const lotNative = selectedLeg === "export" && lotCurrency.toUpperCase() !== "USD";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t("trips.recordSale")}</h2>
        {selected.size > 0 && (
          <Button size="sm" onClick={openLot}>{t("trips.sellLot", { n: selected.size })}</Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>{t("trips.item")}</TableHead>
            <TableHead className="w-16">{t("trips.leg")}</TableHead>
            <TableHead className="w-20">{t("trips.qty")}</TableHead>
            <TableHead className="w-24">{t("trips.avgCost")}</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {holdings.map((h) => (
            <TableRow key={holdingKey(h)}>
              <TableCell>
                <input type="checkbox" checked={selected.has(holdingKey(h))}
                  disabled={selectedLeg !== null && h.leg !== selectedLeg}
                  onChange={() => toggle(h)} title={t("trips.sellLotHint")} />
              </TableCell>
              <TableCell className="truncate max-w-[260px]">
                {h.name} · {h.set_code}
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

      <h3 className="text-sm font-semibold">{t("trips.salesHistory")}</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("trips.item")}</TableHead>
            <TableHead className="w-24">{t("trips.month")}</TableHead>
            <TableHead className="w-12">{t("trips.qty")}</TableHead>
            <TableHead className="w-20">{t("trips.saleGross")}</TableHead>
            <TableHead className="w-20">{t("trips.saleCogs")}</TableHead>
            <TableHead className="w-20">{t("trips.saleMargin")}</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sales.map((s) => (
            <TableRow key={s.key}>
              <TableCell className="truncate max-w-[240px]">{s.name}</TableCell>
              <TableCell>{s.sold_at}</TableCell>
              <TableCell>{s.quantity}</TableCell>
              <TableCell>${s.gross_usd}</TableCell>
              <TableCell>${s.cogs_usd}</TableCell>
              <TableCell className={s.margin_usd < 0 ? "text-destructive" : ""}>${s.margin_usd}</TableCell>
              <TableCell>
                {s.quantity > 0 && (
                  <AlertDialog>
                    <AlertDialogTrigger render={<Button variant="ghost" size="icon" className="size-7" />}>
                      <Undo2 className="size-4" />
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("trips.void")}</AlertDialogTitle>
                        <AlertDialogDescription>{t("trips.voidConfirm")}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("trips.cancel")}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => voidSale(s)}>{t("trips.void")}</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </TableCell>
            </TableRow>
          ))}
          {sales.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-muted-foreground">{t("trips.empty")}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>

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
            <Button disabled={!proceeds} onClick={recordSale}>{t("trips.recordSale")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lotOpen} onOpenChange={(o) => !o && setLotOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t("trips.lotSaleTitle", { n: selectedHoldings.length })}</DialogTitle></DialogHeader>
          <div className="max-h-40 overflow-auto rounded-md border text-sm">
            {selectedHoldings.map((h) => (
              <div key={holdingKey(h)} className="flex items-center justify-between px-2 py-1">
                <span className="truncate">{h.name}{h.psa_grade ? ` · PSA ${h.psa_grade}` : ""}{h.item_type === "sealed" ? ` · ${h.sealed_condition}/${h.variant_edition}` : ""}</span>
                <span className="shrink-0 text-muted-foreground">×{h.qty_on_hand}</span>
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
            <Button disabled={!lotGross} onClick={recordLotSale}>{t("trips.recordSale")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
