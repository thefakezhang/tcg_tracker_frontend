"use client";

import { useCallback, useEffect, useState } from "react";
import { Undo2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
type CardGame = "pokemon" | "mtg";
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
import { Field, FieldGroup } from "@/components/ui/field";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface Holding {
  game: CardGame;
  card_id: number;
  name: string;
  set_code: string;
  condition_id: number;
  psa_grade: number;
  qty_on_hand: number;
  avg_cost_usd: number;
  total_cost_usd: number;
}

interface SaleRow {
  sale_id: number;
  game: CardGame;
  card_id: number;
  condition_id: number;
  psa_grade: number;
  name: string;
  sold_at: string;
  quantity: number;
  gross_usd: number;
  fees_usd: number;
  cogs_usd: number;
  margin_usd: number;
}

const SALE_TABLE: Record<CardGame, string> = { pokemon: "pokemon_sales", mtg: "mtg_sales" };
const DEF_TABLE: Record<CardGame, string> = { pokemon: "pokemon_card_definitions", mtg: "mtg_card_definitions_v" };

// Holdings are global (FIFO pools by SKU across trips); the trip P&L picks up
// whichever layers a sale consumes. This tab is the place to record sales.
export default function SalesTab({ tripId: _tripId }: { tripId: number }) {
  const { t } = useTranslation();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [sel, setSel] = useState<Holding | null>(null);
  const [qty, setQty] = useState("1");
  const [gross, setGross] = useState("");
  const [fees, setFees] = useState("0");
  const [soldAt, setSoldAt] = useState(new Date().toISOString().slice(0, 10));

  const fetchHoldings = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("inventory_holdings_v")
      .select("game, card_id, name, set_code, condition_id, psa_grade, qty_on_hand, avg_cost_usd, total_cost_usd")
      .order("total_cost_usd", { ascending: false });
    setHoldings((data as Holding[]) ?? []);
  }, []);

  const fetchSales = useCallback(async () => {
    const supabase = createClient();
    const out: SaleRow[] = [];
    for (const game of ["pokemon", "mtg"] as CardGame[]) {
      const { data } = await supabase
        .from(SALE_TABLE[game])
        .select("sale_id, card_id, condition_id, psa_grade, sold_at, quantity, gross_usd, fees_usd, cogs_usd, margin_usd")
        .order("sold_at", { ascending: false })
        .limit(50);
      const rows = (data as Omit<SaleRow, "game" | "name">[]) ?? [];
      if (rows.length === 0) continue;
      const ids = [...new Set(rows.map((r) => r.card_id))];
      const { data: defs } = await supabase
        .from(DEF_TABLE[game])
        .select("card_id, regional_name, set_code, card_number")
        .in("card_id", ids);
      const nameMap = new Map<number, string>();
      for (const d of (defs as { card_id: number; regional_name: string; set_code: string; card_number: string | null }[]) ?? []) {
        nameMap.set(d.card_id, `${d.regional_name} · ${d.set_code} ${d.card_number ?? ""}`.trim());
      }
      for (const r of rows) out.push({ ...r, game, name: nameMap.get(r.card_id) ?? `#${r.card_id}` });
    }
    out.sort((a, b) => (a.sold_at < b.sold_at ? 1 : -1));
    setSales(out);
  }, []);

  useEffect(() => { fetchHoldings(); fetchSales(); }, [fetchHoldings, fetchSales]);

  async function recordSale() {
    if (!sel) return;
    const supabase = createClient();
    const { error } = await supabase.rpc("record_sale", {
      p_game: sel.game, p_card_id: sel.card_id, p_condition_id: sel.condition_id,
      p_psa_grade: sel.psa_grade, p_quantity: Number(qty), p_gross_usd: Number(gross),
      p_fees_usd: Number(fees) || 0, p_sold_at: soldAt,
    });
    if (error) { alert(error.message); return; }
    setSel(null); setGross(""); setFees("0"); setQty("1");
    await fetchHoldings(); await fetchSales();
  }

  // Void = reverse a sale: restores the consumed FIFO layers and books a negating
  // entry (accounting-correct — sales aren't hard-deleted).
  async function voidSale(s: SaleRow) {
    const supabase = createClient();
    const { error } = await supabase.rpc("record_sale", {
      p_game: s.game, p_card_id: s.card_id, p_condition_id: s.condition_id,
      p_psa_grade: s.psa_grade, p_quantity: -Math.abs(s.quantity), p_gross_usd: 0, p_fees_usd: 0,
      p_sold_at: new Date().toISOString().slice(0, 10), p_reverses_sale_id: s.sale_id,
    });
    if (error) { alert(error.message); return; }
    await fetchHoldings(); await fetchSales();
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">{t("trips.recordSale")}</h2>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("trips.card")}</TableHead>
            <TableHead className="w-20">{t("trips.qty")}</TableHead>
            <TableHead className="w-24">{t("trips.avgCost")}</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {holdings.map((h) => (
            <TableRow key={`${h.game}-${h.card_id}-${h.condition_id}-${h.psa_grade}`}>
              <TableCell className="truncate max-w-[280px]">{h.name} · {h.set_code}</TableCell>
              <TableCell>{h.qty_on_hand}</TableCell>
              <TableCell>${h.avg_cost_usd}</TableCell>
              <TableCell>
                <Button size="sm" variant="outline" onClick={() => { setSel(h); setQty("1"); }}>
                  {t("trips.recordSale")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {holdings.length === 0 && (
            <TableRow><TableCell colSpan={4} className="text-muted-foreground">{t("trips.empty")}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>

      <h3 className="text-sm font-semibold">{t("trips.salesHistory")}</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("trips.card")}</TableHead>
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
            <TableRow key={`${s.game}-${s.sale_id}`}>
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
            <Field><Label>{t("trips.saleGross")}</Label>
              <Input type="number" value={gross} onChange={(e) => setGross(e.target.value)} autoFocus /></Field>
            <Field><Label>{t("trips.saleFees")}</Label>
              <Input type="number" value={fees} onChange={(e) => setFees(e.target.value)} /></Field>
            <Field><Label>{t("trips.month")}</Label>
              <Input type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)} /></Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSel(null)}>{t("trips.cancel")}</Button>
            <Button disabled={!gross} onClick={recordSale}>{t("trips.recordSale")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
