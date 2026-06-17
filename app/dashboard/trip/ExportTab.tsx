"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup } from "@/components/ui/field";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface Perf {
  good_id: number;
  description: string;
  category: string | null;
  qty_brought: number;
  unit_cost_usd: number;
  qty_sold: number;
  qty_remaining: number;
  revenue_usd: number;
  profit_usd: number;
  remaining_cost_usd: number;
}

export default function ExportTab({ tripId }: { tripId: number }) {
  const { t } = useTranslation();
  const [perf, setPerf] = useState<Perf[]>([]);

  const [addOpen, setAddOpen] = useState(false);
  const [desc, setDesc] = useState("");
  const [cat, setCat] = useState("");
  const [qty, setQty] = useState("1");
  const [cur, setCur] = useState("USD");
  const [unitCost, setUnitCost] = useState("");
  const [fx, setFx] = useState("1");

  const [saleGood, setSaleGood] = useState<Perf | null>(null);
  const [sQty, setSQty] = useState("1");
  const [sProceeds, setSProceeds] = useState("");
  const [sCur, setSCur] = useState("JPY");
  const [sFx, setSFx] = useState("0.0067");
  const [sFees, setSFees] = useState("0");
  const [sDate, setSDate] = useState(new Date().toISOString().slice(0, 10));

  const fetchPerf = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("export_goods_performance_v")
      .select("good_id, description, category, qty_brought, unit_cost_usd, qty_sold, qty_remaining, revenue_usd, profit_usd, remaining_cost_usd")
      .eq("trip_id", tripId)
      .order("good_id", { ascending: true });
    setPerf((data as Perf[]) ?? []);
  }, [tripId]);

  useEffect(() => { fetchPerf(); }, [fetchPerf]);

  async function addGood() {
    const supabase = createClient();
    const fxn = Number(fx) || 1;
    const uc = Number(unitCost) || 0;
    await supabase.from("export_goods").insert({
      trip_id: tripId, description: desc, category: cat || null, quantity: Number(qty),
      orig_currency: cur.toUpperCase(), unit_cost_orig: uc, fx_rate_used: fxn,
      unit_cost_usd: Math.round(uc * fxn * 10000) / 10000,
    });
    setAddOpen(false); setDesc(""); setCat(""); setQty("1"); setUnitCost("");
    await fetchPerf();
  }

  async function recordExportSale() {
    if (!saleGood) return;
    const supabase = createClient();
    const { error } = await supabase.rpc("record_export_sale", {
      p_good_id: saleGood.good_id, p_quantity_sold: Number(sQty),
      p_proceeds_orig: Number(sProceeds), p_orig_currency: sCur.toUpperCase(),
      p_fx_rate: Number(sFx) || 1, p_sold_at: sDate, p_fees_usd: Number(sFees) || 0,
    });
    if (error) { alert(error.message); return; }
    setSaleGood(null); setSProceeds(""); setSFees("0"); setSQty("1");
    await fetchPerf();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t("trips.exportGoods")}</h2>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="size-4 mr-1" />{t("trips.addGood")}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("trips.goodDesc")}</TableHead>
            <TableHead className="w-20">{t("trips.brought")}</TableHead>
            <TableHead className="w-20">{t("trips.remaining")}</TableHead>
            <TableHead className="w-24">{t("trips.revenue")}</TableHead>
            <TableHead className="w-24">{t("trips.profit")}</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {perf.map((g) => (
            <TableRow key={g.good_id}>
              <TableCell className="truncate max-w-[260px]">
                {g.description}{g.category ? <span className="text-muted-foreground"> · {g.category}</span> : null}
              </TableCell>
              <TableCell>{g.qty_brought} @ ${g.unit_cost_usd}</TableCell>
              <TableCell>{g.qty_remaining}</TableCell>
              <TableCell>${g.revenue_usd}</TableCell>
              <TableCell className={g.profit_usd < 0 ? "text-destructive" : ""}>${g.profit_usd}</TableCell>
              <TableCell>
                {g.qty_remaining > 0 && (
                  <Button size="sm" variant="outline" onClick={() => { setSaleGood(g); setSQty(String(g.qty_remaining)); }}>
                    {t("trips.recordExportSale")}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {perf.length === 0 && (
            <TableRow><TableCell colSpan={6} className="text-muted-foreground">{t("trips.empty")}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t("trips.addGood")}</DialogTitle></DialogHeader>
          <FieldGroup>
            <Field><Label>{t("trips.goodDesc")}</Label>
              <Input value={desc} onChange={(e) => setDesc(e.target.value)} autoFocus /></Field>
            <Field><Label>{t("trips.goodCategory")}</Label>
              <Input value={cat} onChange={(e) => setCat(e.target.value)} /></Field>
            <Field><Label>{t("trips.goodQty")}</Label>
              <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
            <Field><Label>{t("trips.lotCurrency")}</Label>
              <Input value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
            <Field><Label>{t("trips.goodUnitCost")}</Label>
              <Input type="number" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} /></Field>
            <Field><Label>{t("trips.fxRate")}</Label>
              <Input type="number" value={fx} onChange={(e) => setFx(e.target.value)} /></Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>{t("trips.cancel")}</Button>
            <Button disabled={!desc || !unitCost} onClick={addGood}>{t("trips.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!saleGood} onOpenChange={(o) => !o && setSaleGood(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{saleGood?.description}</DialogTitle></DialogHeader>
          <FieldGroup>
            <Field><Label>{t("trips.saleQty")}</Label>
              <Input type="number" value={sQty} onChange={(e) => setSQty(e.target.value)} /></Field>
            <Field><Label>{t("trips.proceeds")}</Label>
              <Input type="number" value={sProceeds} onChange={(e) => setSProceeds(e.target.value)} autoFocus /></Field>
            <Field><Label>{t("trips.lotCurrency")}</Label>
              <Input value={sCur} onChange={(e) => setSCur(e.target.value)} /></Field>
            <Field><Label>{t("trips.fxRate")}</Label>
              <Input type="number" value={sFx} onChange={(e) => setSFx(e.target.value)} /></Field>
            <Field><Label>{t("trips.saleFees")}</Label>
              <Input type="number" value={sFees} onChange={(e) => setSFees(e.target.value)} /></Field>
            <Field><Label>{t("trips.expenseDate")}</Label>
              <Input type="date" value={sDate} onChange={(e) => setSDate(e.target.value)} /></Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaleGood(null)}>{t("trips.cancel")}</Button>
            <Button disabled={!sProceeds} onClick={recordExportSale}>{t("trips.recordExportSale")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
