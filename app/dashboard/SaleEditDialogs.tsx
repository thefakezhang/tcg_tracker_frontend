"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSaving } from "@/lib/use-saving";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup } from "@/components/ui/field";

// Editing a COMMITTED sale, shared between the per-trip Sales tab and the
// global sales ledger (SalesView). Edits go through the edit_sale /
// edit_sealed_sale RPCs: an in-place correction, not revert + re-record.
// Editing quantity re-runs FIFO (the RPC restores the old cost layers and
// re-consumes for the new quantity), so COGS is recomputed; a POS-linked sale
// is refused by the RPC with instructions to reverse the POS session instead,
// and that message surfaces here via useSaving.
export interface EditableSale {
  key: string;
  kind: "single" | "sealed";
  game: string; // 'pokemon' | 'mtg' | 'pokemon_sealed'
  sale_id: number;
  name: string;
  quantity: number;
  sold_at: string;
  gross_usd: number;
  cogs_usd: number;
  fees_usd: number;
  orig_currency: string; // 'USD' (import) or native e.g. 'JPY' (export)
  proceeds_orig: number;
  fx_rate_used: number;
}

// Split a total across items by weight, exact to the cent (largest remainder).
export function allocate(total: number, weights: number[]): number[] {
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

const isNativeCurrency = (s: EditableSale | null | undefined) =>
  !!s?.orig_currency && s.orig_currency.toUpperCase() !== "USD";

// Owns both edit dialogs (single sale + lot) and their save logic. Callers
// render `dialogs` once and open with `openEdit` / `openEditLot`; `onSaved`
// runs after a successful edit so the caller can refetch its own data.
export function useSaleEditDialogs(onSaved: () => void | Promise<void>) {
  const { t } = useTranslation();
  const { saving, save } = useSaving();
  const [editSel, setEditSel] = useState<EditableSale | null>(null);
  const [eQty, setEQty] = useState("1");
  const [eProceeds, setEProceeds] = useState("");
  const [eFees, setEFees] = useState("0");
  const [eFx, setEFx] = useState("1");
  const [eDate, setEDate] = useState("");
  const [eLotItems, setELotItems] = useState<EditableSale[] | null>(null);
  const [eLotGross, setELotGross] = useState("");
  const [eLotFees, setELotFees] = useState("0");
  const [eLotFx, setELotFx] = useState("1");
  const [eLotDate, setELotDate] = useState("");

  function openEdit(s: EditableSale) {
    const native = isNativeCurrency(s);
    setEditSel(s);
    setEQty(String(s.quantity));
    setEProceeds(String(native ? s.proceeds_orig : s.gross_usd));
    setEFees(String(s.fees_usd));
    setEFx(String(s.fx_rate_used || 1));
    setEDate(s.sold_at);
  }

  async function editSale() {
    if (!editSel || saving) return;
    const s = editSel;
    const supabase = createClient();
    const native = isNativeCurrency(s);
    const grossUsd = native ? Math.round(Number(eProceeds) * Number(eFx) * 100) / 100 : Number(eProceeds);
    const common = {
      p_quantity: Math.max(1, Math.floor(Number(eQty)) || 1),
      p_gross_usd: native ? 0 : grossUsd, p_fees_usd: Number(eFees) || 0, p_sold_at: eDate,
      p_orig_currency: native ? s.orig_currency : null,
      p_proceeds_orig: native ? Number(eProceeds) : null,
      p_fx_rate: native ? Number(eFx) : 1,
    };
    const ok = await save(() => s.kind === "sealed"
      ? supabase.rpc("edit_sealed_sale", { p_sale_id: s.sale_id, ...common })
      : supabase.rpc("edit_sale", { p_game: s.game, p_sale_id: s.sale_id, ...common }));
    if (!ok) return;
    setEditSel(null);
    await onSaved();
  }

  function openEditLot(items: EditableSale[]) {
    const native = isNativeCurrency(items[0]);
    setELotItems(items);
    setELotGross(String(native ? items.reduce((a, s) => a + Number(s.proceeds_orig), 0) : items.reduce((a, s) => a + Number(s.gross_usd), 0)));
    setELotFees(String(items.reduce((a, s) => a + Number(s.fees_usd), 0)));
    setELotFx(String(items[0]?.fx_rate_used || 1));
    setELotDate(items[0]?.sold_at ?? new Date().toISOString().slice(0, 10));
  }

  // Re-split the new lot total + fees across the members by their CURRENT cost
  // share (gross -> cogs -> even fallback) and edit each member in place. Each
  // edit re-runs FIFO for the unchanged qty, so COGS is stable and only the
  // revenue/fees re-allocate. Sequential (no lot-level RPC); stops on first error.
  async function editLotSale() {
    if (!eLotItems || saving) return;
    const items = eLotItems;
    const native = isNativeCurrency(items[0]);
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
          p_gross_usd: native ? 0 : grossAlloc[i],
          p_fees_usd: feesAlloc[i], p_sold_at: eLotDate,
          p_orig_currency: native ? s.orig_currency : null,
          p_proceeds_orig: native ? grossAlloc[i] : null,
          p_fx_rate: native ? Number(eLotFx) : 1,
        };
        const { error } = await (s.kind === "sealed"
          ? supabase.rpc("edit_sealed_sale", { p_sale_id: s.sale_id, ...common })
          : supabase.rpc("edit_sale", { p_game: s.game, p_sale_id: s.sale_id, ...common }));
        if (error) throw error;
      }
    });
    if (!ok) return;
    setELotItems(null);
    await onSaved();
  }

  const eNative = isNativeCurrency(editSel);
  const eLotNative = isNativeCurrency(eLotItems?.[0]);

  const dialogs = (
    <>
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
    </>
  );

  return { openEdit, openEditLot, saving, dialogs };
}
