"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSaving } from "@/lib/use-saving";
import { useFxRate, fmtRate } from "@/lib/use-fx-rate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup } from "@/components/ui/field";
import ReceiptsDialog from "../Receipts";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface Expense {
  expense_id: number;
  description: string;
  category: string | null;
  incurred_at: string;
  orig_currency: string;
  amount_orig: number;
  amount_usd: number;
}

// tripId === null → general/overhead business expenses not tied to any trip.
export default function ExpensesTab({ tripId }: { tripId: number | null }) {
  const { t } = useTranslation();
  const { saving, save } = useSaving();
  const [rows, setRows] = useState<Expense[]>([]);
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState("");
  const [cat, setCat] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [cur, setCur] = useState("USD");
  const [amt, setAmt] = useState("");
  const [fx, setFx] = useState("1");
  const { rateFor } = useFxRate();

  // Default the FX field to the live market rate for the chosen currency; the user
  // can still override. Only drives the add form (edits have no separate FX here).
  useEffect(() => {
    const r = rateFor(cur);
    if (r !== null) setFx(fmtRate(r));
  }, [cur, rateFor]);

  const fetchRows = useCallback(async () => {
    const supabase = createClient();
    const base = supabase
      .from("trip_expenses")
      .select("expense_id, description, category, incurred_at, orig_currency, amount_orig, amount_usd")
      .order("incurred_at", { ascending: false });
    const { data } = await (tripId === null ? base.is("trip_id", null) : base.eq("trip_id", tripId));
    setRows((data as Expense[]) ?? []);
  }, [tripId]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  async function addExpense() {
    const supabase = createClient();
    const fxn = Number(fx) || 1;
    const a = Number(amt) || 0;
    const ok = await save(() => supabase.from("trip_expenses").insert({
      trip_id: tripId, description: desc, category: cat || null, incurred_at: date,
      orig_currency: cur.toUpperCase(), amount_orig: a, fx_rate_used: fxn,
      amount_usd: Math.round(a * fxn * 100) / 100,
    }));
    if (!ok) return;
    setOpen(false); setDesc(""); setCat(""); setAmt("");
    await fetchRows();
  }

  async function remove(id: number) {
    const supabase = createClient();
    await supabase.from("trip_expenses").delete().eq("expense_id", id);
    await fetchRows();
  }

  const total = rows.reduce((s, r) => s + Number(r.amount_usd), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">{t("trips.expenses")}</h2>
          {tripId === null && <p className="text-xs text-muted-foreground">{t("expenses.overheadNote")}</p>}
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4 mr-1" />{t("trips.addExpense")}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("trips.expenseDesc")}</TableHead>
            <TableHead className="w-28">{t("trips.expenseCategory")}</TableHead>
            <TableHead className="w-28">{t("trips.expenseDate")}</TableHead>
            <TableHead className="w-28">{t("trips.expenseAmount")}</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.expense_id}>
              <TableCell className="truncate max-w-[240px]">{r.description}</TableCell>
              <TableCell>{r.category ?? "—"}</TableCell>
              <TableCell>{r.incurred_at}</TableCell>
              <TableCell>${r.amount_usd} <span className="text-xs text-muted-foreground">({r.orig_currency} {r.amount_orig})</span></TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-1">
                  <ReceiptsDialog ownerType="expense" ownerId={r.expense_id} />
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => remove(r.expense_id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={5} className="text-muted-foreground">{t("trips.empty")}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
      {rows.length > 0 && <p className="text-sm font-medium">Total: ${total.toFixed(2)}</p>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t("trips.addExpense")}</DialogTitle></DialogHeader>
          <FieldGroup>
            <Field><Label>{t("trips.expenseDesc")}</Label>
              <Input value={desc} onChange={(e) => setDesc(e.target.value)} autoFocus /></Field>
            <Field><Label>{t("trips.expenseCategory")}</Label>
              <Input value={cat} onChange={(e) => setCat(e.target.value)} placeholder="airfare, lodging, shipping..." /></Field>
            <Field><Label>{t("trips.expenseDate")}</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field><Label>{t("trips.lotCurrency")}</Label>
              <Input value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
            <Field><Label>{t("trips.expenseAmount")}</Label>
              <Input type="number" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
            <Field><Label>{t("trips.fxRate")}</Label>
              <Input type="number" value={fx} onChange={(e) => setFx(e.target.value)} /></Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>{t("trips.cancel")}</Button>
            <Button disabled={!desc || !amt || saving} onClick={addExpense}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : t("trips.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
