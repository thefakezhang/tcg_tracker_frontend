"use client";

// Recording a trade: cards out, cards in, and cash closing the gap.
//
// A trade is two sides that settle against each other. Both sides are ordinary
// rows booked through the paths that already exist - the outbound is a lot sale
// with its own FIFO and COGS, the inbound an acquisition lot with its own
// landed cost - and a trade is the record that they were one event, plus the
// assertion that they balance:
//
//     value_in = value_out + cash        (cash signed: + paid, - received)
//
// So this screen links rather than records. That is deliberate: it means a
// trade's outbound side realises a real gain or loss against the cards given
// up, instead of inventing a parallel way to dispose of stock.

import { useCallback, useMemo, useState } from "react";
import { ArrowLeftRight, Check, Loader2, Link2Off, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useSaving } from "@/lib/use-saving";
import { balanceOf, signedCash, deriveValueIn, type CashDirection, type TradeDraft } from "@/lib/trades";
import { useSupabaseQuery, QueryError } from "./use-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

interface TradeRow {
  trade_id: number;
  traded_at: string;
  counterparty: string | null;
  cash_usd: number;
  sale_group: number;
  value_out_usd: number;
  lot_id: number;
  value_in_usd: number;
  balanced: boolean;
  imbalance_usd: number;
  notes: string | null;
}

interface SaleOption { sale_group: number; sold_at: string; gross_proceeds_usd: number; leg: string }
interface LotOption { lot_id: number; acquired_at: string; total_cost_usd: number; shop_label: string | null }

const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function TradesView() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const trades = useSupabaseQuery<TradeRow[]>("trades:list", async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("trades_v")
      .select("trade_id, traded_at, counterparty, cash_usd, sale_group, value_out_usd, lot_id, value_in_usd, balanced, imbalance_usd, notes")
      .order("traded_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data ?? []) as TradeRow[];
  });

  const { save, saving } = useSaving();
  const unlink = useCallback(async (tradeId: number) => {
    const supabase = createClient();
    await save(async () => supabase.rpc("unlink_trade", { p_trade_id: tradeId }));
    await trades.retry();
  }, [save, trades]);

  if (trades.error) return <div className="p-4"><QueryError error={trades.error} onRetry={trades.retry} /></div>;

  const rows = trades.data ?? [];

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <p className="max-w-prose text-sm text-muted-foreground">{t("trades.intro")}</p>
        <Button onClick={() => setOpen(true)}>
          <ArrowLeftRight className="size-4" aria-hidden /><span className="ml-1">{t("trades.record")}</span>
        </Button>
      </div>

      {trades.isLoading && !trades.data ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <ArrowLeftRight className="size-8" aria-hidden />
          <p className="text-sm">{t("trades.empty")}</p>
          <p className="max-w-md text-xs">{t("trades.emptyHint")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.trade_id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {r.counterparty || t("trades.noCounterparty")}
                  <span className="ml-2 font-normal text-muted-foreground">{r.traded_at}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {t("trades.sidesSummary", {
                    out: money(r.value_out_usd),
                    sale: String(r.sale_group),
                    in: money(r.value_in_usd),
                    lot: String(r.lot_id),
                  })}
                </p>
              </div>
              {r.cash_usd !== 0 && (
                <Badge variant="outline" className="tabular-nums">
                  {r.cash_usd > 0
                    ? t("trades.cashPaidBadge", { amount: money(r.cash_usd) })
                    : t("trades.cashReceivedBadge", { amount: money(Math.abs(r.cash_usd)) })}
                </Badge>
              )}
              {/* Both sides are mandatory and the RPC refuses an imbalance, so a
                  false here means something drifted after the fact. Shown rather
                  than assumed away. */}
              {!r.balanced && (
                <Badge variant="outline" className="border-destructive/50 text-destructive">
                  <TriangleAlert className="mr-1 size-3" aria-hidden />
                  {t("trades.outOfBalance", { amount: money(r.imbalance_usd) })}
                </Badge>
              )}
              <Button variant="ghost" size="sm" disabled={saving} onClick={() => unlink(r.trade_id)}
                title={t("trades.unlinkHint")}>
                <Link2Off className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <RecordTradeDialog open={open} onOpenChange={setOpen} onRecorded={() => { setOpen(false); trades.retry(); }} />
    </div>
  );
}

function RecordTradeDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onRecorded: () => void;
}) {
  const { t } = useTranslation();
  const { save, saving } = useSaving();
  const [saleGroup, setSaleGroup] = useState<number | null>(null);
  const [lotId, setLotId] = useState<number | null>(null);
  const [cashAmount, setCashAmount] = useState("");
  const [direction, setDirection] = useState<CashDirection>("none");
  const [counterparty, setCounterparty] = useState("");
  const [notes, setNotes] = useState("");

  // Only sides that are not already spoken for. A sale or lot already in a
  // trade is not offered, because the RPC would refuse it anyway and finding
  // that out after filling in the form is worse than not seeing it.
  const options = useSupabaseQuery<{ sales: SaleOption[]; lots: LotOption[] }>(
    props.open ? "trades:options" : null,
    async () => {
      const supabase = createClient();
      const [{ data: taken }, { data: sales }, { data: lots }] = await Promise.all([
        supabase.from("trades").select("sale_group, lot_id"),
        supabase.from("sale_lots").select("sale_group, sold_at, gross_proceeds_usd, leg")
          .eq("status", "finalized").order("sold_at", { ascending: false }).limit(100),
        supabase.from("acquisition_lots").select("lot_id, acquired_at, total_cost_usd, shop_label")
          .eq("lines_imported", true).order("acquired_at", { ascending: false }).limit(100),
      ]);
      const usedSales = new Set((taken ?? []).map((r) => (r as { sale_group: number }).sale_group));
      const usedLots = new Set((taken ?? []).map((r) => (r as { lot_id: number }).lot_id));
      return {
        sales: ((sales ?? []) as SaleOption[]).filter((s) => !usedSales.has(s.sale_group)),
        lots: ((lots ?? []) as LotOption[]).filter((l) => !usedLots.has(l.lot_id)),
      };
    },
  );

  const sale = options.data?.sales.find((s) => s.sale_group === saleGroup) ?? null;
  const lot = options.data?.lots.find((l) => l.lot_id === lotId) ?? null;

  const draft: TradeDraft = useMemo(() => ({
    valueOutUsd: sale ? Number(sale.gross_proceeds_usd) : null,
    valueInUsd: lot ? Number(lot.total_cost_usd) : null,
    cashAmount: cashAmount === "" ? 0 : Number(cashAmount),
    direction,
  }), [sale, lot, cashAmount, direction]);

  const balance = balanceOf(draft);

  const submit = useCallback(async () => {
    if (saleGroup == null || lotId == null) return;
    const supabase = createClient();
    // save() surfaces the RPC's own complaint, which is the useful one here:
    // link_trade names both figures when a trade does not balance.
    const ok = await save(async () => supabase.rpc("link_trade", {
      p_sale_group: saleGroup,
      p_lot_id: lotId,
      p_cash_usd: signedCash(draft),
      p_counterparty: counterparty.trim() || null,
      p_traded_at: null,
      p_notes: notes.trim() || null,
    }));
    if (ok) props.onRecorded();
  }, [saleGroup, lotId, draft, counterparty, notes, save, props]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{t("trades.record")}</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{t("trades.dialogHint")}</p>

          <label className="block space-y-1">
            <span className="text-xs font-medium">{t("trades.gaveLabel")}</span>
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={saleGroup ?? ""} onChange={(e) => setSaleGroup(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t("trades.pickSale")}</option>
              {(options.data?.sales ?? []).map((s) => (
                <option key={s.sale_group} value={s.sale_group}>
                  #{s.sale_group} · {s.sold_at} · {money(Number(s.gross_proceeds_usd))}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium">{t("trades.gotLabel")}</span>
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={lotId ?? ""} onChange={(e) => setLotId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t("trades.pickLot")}</option>
              {(options.data?.lots ?? []).map((l) => (
                <option key={l.lot_id} value={l.lot_id}>
                  #{l.lot_id} · {l.acquired_at} · {money(Number(l.total_cost_usd))}{l.shop_label ? ` · ${l.shop_label}` : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium">{t("trades.cashDirection")}</span>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={direction} onChange={(e) => setDirection(e.target.value as CashDirection)}>
                <option value="none">{t("trades.cashNone")}</option>
                <option value="paid">{t("trades.cashPaid")}</option>
                <option value="received">{t("trades.cashReceived")}</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium">{t("trades.cashAmount")}</span>
              <Input type="number" step="0.01" min="0" value={cashAmount} disabled={direction === "none"}
                onChange={(e) => setCashAmount(e.target.value)} placeholder="0.00" />
            </label>
          </div>

          {/* The arithmetic, shown reconciling as you type rather than as a
              rejection after you have filled everything in. */}
          <div className={`rounded-md border p-3 text-sm ${
            !balance.complete ? "border-border bg-muted/30"
            : balance.balanced ? "border-green-500/50 bg-green-500/10"
            : "border-amber-500/50 bg-amber-500/10"}`}>
            {!balance.complete ? (
              <p className="text-muted-foreground">{t("trades.pickBothSides")}</p>
            ) : (
              <div className="space-y-1 font-mono text-xs">
                <p>{t("trades.balanceOut", { amount: money(draft.valueOutUsd ?? 0) })}</p>
                <p>{t("trades.balanceCash", { amount: money(signedCash(draft)) })}</p>
                <p className="border-t pt-1">
                  {t("trades.balanceExpected", { amount: money(balance.expectedIn ?? 0) })}
                </p>
                <p>{t("trades.balanceActual", { amount: money(draft.valueInUsd ?? 0) })}</p>
                <p className={balance.balanced ? "font-semibold text-green-700 dark:text-green-400" : "font-semibold text-amber-700 dark:text-amber-400"}>
                  {balance.balanced
                    ? t("trades.balances")
                    : t("trades.doesNotBalance", { amount: money(balance.imbalance ?? 0) })}
                </p>
                {!balance.balanced && draft.valueOutUsd != null && (
                  <p className="text-muted-foreground">
                    {t("trades.balanceFixHint", {
                      amount: money(deriveValueIn(draft.valueOutUsd, signedCash(draft))),
                    })}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium">{t("trades.counterparty")}</span>
              <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium">{t("trades.notes")}</span>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>

        </div>

        <DialogFooter>
          <Button disabled={saving || !balance.balanced || saleGroup == null || lotId == null} onClick={submit}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            <span className="ml-1">{t("trades.record")}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
