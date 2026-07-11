"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import BalanceSheetCard from "./BalanceSheetCard";
import AccountingRollupView from "./AccountingRollupView";
import JournalEntryDialog, { type GlAccount } from "./JournalEntryDialog";
import AccountRegisterModal from "./AccountRegisterModal";
import { formatUsd as usd } from "@/lib/money";

// Business-level financials, all derived from the general ledger (docs/general_ledger.md).

interface TrialRow { account_id: number; code: string; name: string; type: string; is_cash: boolean; balance_usd: number; }
interface IncomeRow { account_id: number; code: string; name: string; type: string; amount_usd: number; }
interface JournalEntry {
  entry_id: number; entry_date: string; memo: string | null; source: string;
  gl_journal_lines: { amount_usd: number }[];
}
interface TripCapital { trip_id: number; capital_invested_usd: number; cumulative_invested_usd: number; }
interface TripLite { trip_id: number; name: string; started_at: string | null; }
interface CashFlowRow { activity: string; source: string; net_usd: number; }

// Assets & expenses are debit-normal; show their stored balance. Liabilities,
// equity, and income are credit-normal (stored negative); flip so each account
// reads as a natural positive figure.
const natural = (type: string, bal: number) =>
  type === "asset" || type === "expense" ? bal : -bal;

const TYPE_ORDER = ["asset", "liability", "equity", "income", "expense"];

export default function FinancesView() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<GlAccount[]>([]);
  const [trial, setTrial] = useState<TrialRow[]>([]);
  const [income, setIncome] = useState<IncomeRow[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [caps, setCaps] = useState<TripCapital[]>([]);
  const [trips, setTrips] = useState<Map<number, TripLite>>(new Map());
  const [cashFlow, setCashFlow] = useState<CashFlowRow[]>([]);
  const [entryOpen, setEntryOpen] = useState(false);
  const [register, setRegister] = useState<GlAccount | null>(null);

  const fetchAll = useCallback(async () => {
    const supabase = createClient();
    const [acc, tb, is, jn, cap, tr, cf] = await Promise.all([
      supabase.from("gl_accounts").select("account_id, code, name, type, is_cash, is_owner").eq("is_active", true).order("sort"),
      supabase.rpc("get_trial_balance"),
      supabase.rpc("get_income_statement"),
      supabase.from("gl_journal").select("entry_id, entry_date, memo, source, gl_journal_lines(amount_usd)").order("entry_date", { ascending: false }).limit(50),
      supabase.rpc("get_trip_capital_invested"),
      supabase.from("trips").select("trip_id, name, started_at"),
      supabase.rpc("get_cash_flow"),
    ]);
    setAccounts((acc.data as GlAccount[]) ?? []);
    setTrial((tb.data as TrialRow[]) ?? []);
    setIncome((is.data as IncomeRow[]) ?? []);
    setJournal((jn.data as JournalEntry[]) ?? []);
    setCaps((cap.data as TripCapital[]) ?? []);
    setCashFlow((cf.data as CashFlowRow[]) ?? []);
    const m = new Map<number, TripLite>();
    for (const x of (tr.data as TripLite[]) ?? []) m.set(x.trip_id, x);
    setTrips(m);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function deleteEntry(id: number) {
    const supabase = createClient();
    await supabase.rpc("gl_delete_entry", { p_entry_id: id });
    await fetchAll();
  }

  const acctById = new Map(accounts.map((a) => [a.account_id, a]));
  const revenue = income.filter((r) => r.type === "income");
  const expenses = income.filter((r) => r.type === "expense");
  const revTotal = revenue.reduce((s, r) => s + Number(r.amount_usd), 0);
  const expTotal = expenses.reduce((s, r) => s + Number(r.amount_usd), 0);

  const capRows = [...caps].sort((a, b) => {
    const sa = trips.get(a.trip_id)?.started_at ?? "", sb = trips.get(b.trip_id)?.started_at ?? "";
    return sa === sb ? a.trip_id - b.trip_id : sa < sb ? -1 : 1;
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEntryOpen(true)}><Plus className="size-4 mr-1" />{t("gl.newEntry")}</Button>
      </div>

      <BalanceSheetCard />

      {/* Income statement */}
      <Card size="sm">
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t("gl.incomeStatement")}</CardTitle></CardHeader>
        <CardContent className="text-sm">
          <div className="flex justify-between font-medium"><span>{t("gl.revenue")}</span><span className="tabular-nums">{usd(revTotal)}</span></div>
          {expenses.map((r) => (
            <div key={r.account_id} className="flex justify-between text-muted-foreground">
              <span className="pl-3">{r.name}</span><span className="tabular-nums">({usd(Number(r.amount_usd))})</span>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
            <span>{t("gl.netIncome")}</span>
            <span className={`tabular-nums ${revTotal - expTotal < 0 ? "text-destructive" : ""}`}>{usd(revTotal - expTotal)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Cash flow */}
      {cashFlow.length > 0 && (
        <Card size="sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t("gl.cashFlow")}</CardTitle></CardHeader>
          <CardContent className="text-sm">
            {["Operating", "Financing", "Transfers"].filter((act) => cashFlow.some((r) => r.activity === act)).map((act) => (
              <div key={act} className="mb-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`gl.cf.${act}` as never)}</div>
                {cashFlow.filter((r) => r.activity === act).map((r) => (
                  <div key={r.source} className="flex justify-between">
                    <span className="pl-3 capitalize">{t(`gl.src.${r.source}` as never)}</span>
                    <span className={`tabular-nums ${r.net_usd < 0 ? "text-destructive" : ""}`}>{usd(Number(r.net_usd))}</span>
                  </div>
                ))}
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
              <span>{t("gl.cashOnHand")}</span>
              <span className="tabular-nums">{usd(cashFlow.reduce((s, r) => s + Number(r.net_usd), 0))}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chart of accounts / trial balance */}
      <Card size="sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t("gl.chartOfAccounts")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("gl.chartNote")}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {TYPE_ORDER.filter((ty) => trial.some((r) => r.type === ty)).map((ty) => (
            <div key={ty}>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`gl.type.${ty}` as never)}</div>
              {trial.filter((r) => r.type === ty).map((r) => (
                <button
                  key={r.account_id}
                  onClick={() => setRegister(acctById.get(r.account_id) ?? null)}
                  className="flex w-full items-center justify-between rounded px-1 py-0.5 text-sm hover:bg-muted/60"
                >
                  <span>{r.name}</span>
                  <span className="tabular-nums">{usd(natural(r.type, Number(r.balance_usd)))}</span>
                </button>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Owner capital by trip */}
      <Card size="sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t("finances.capitalTitle")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("finances.capitalNote")}</p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("finances.capitalTrip")}</TableHead>
                <TableHead className="text-right">{t("trips.capitalInvested")}</TableHead>
                <TableHead className="text-right">{t("trips.capitalCumulative")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {capRows.map((r) => (
                <TableRow key={r.trip_id}>
                  <TableCell>{trips.get(r.trip_id)?.name ?? `Trip ${r.trip_id}`}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(Number(r.capital_invested_usd))}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{usd(Number(r.cumulative_invested_usd))}</TableCell>
                </TableRow>
              ))}
              {capRows.length === 0 && (
                <TableRow><TableCell colSpan={3} className="text-muted-foreground">{t("trips.empty")}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Manual journal entries */}
      <Card size="sm">
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t("gl.journal")}</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">{t("gl.regDate")}</TableHead>
                <TableHead>{t("gl.regDetail")}</TableHead>
                <TableHead className="text-right w-28">{t("gl.amount")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {journal.map((e) => {
                const amt = (e.gl_journal_lines ?? []).reduce((s, l) => s + Math.max(0, Number(l.amount_usd)), 0);
                return (
                  <TableRow key={e.entry_id}>
                    <TableCell className="text-xs">{e.entry_date}</TableCell>
                    <TableCell className="text-xs"><span className="text-muted-foreground">{e.source}</span>{e.memo ? ` · ${e.memo}` : ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{usd(amt)}</TableCell>
                    <TableCell>
                      {e.source !== "opening" && (
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => deleteEntry(e.entry_id)}>
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {journal.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-muted-foreground">{t("gl.journalEmpty")}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AccountingRollupView />

      <JournalEntryDialog accounts={accounts} open={entryOpen} onOpenChange={setEntryOpen} onPosted={fetchAll} />
      <AccountRegisterModal account={register} accounts={accounts} onClose={() => setRegister(null)} onReclassified={fetchAll} />
    </div>
  );
}
