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
import { formatMutationError } from "@/lib/mutation-error";
import { balanceOf, signedCash, deriveValueIn, type CashDirection, type TradeDraft } from "@/lib/trades";
import { selectAll } from "@/lib/supabase/select-all";
import { formatDate } from "@/lib/dates";
import { formatUsd } from "@/lib/money";
import { useSupabaseQuery, QueryError } from "./use-query";
import { useLanguage } from "./LanguageContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

type SupabaseClient = ReturnType<typeof createClient>;

export async function fetchTrades(supabase: SupabaseClient): Promise<TradeRow[]> {
  const rows = await selectAll<TradeRow>(
    () => supabase
      .from("trades_v")
      .select("trade_id, traded_at, counterparty, cash_usd, sale_group, value_out_usd, lot_id, value_in_usd, balanced, imbalance_usd, notes"),
    ["traded_at", "trade_id"],
  );
  return rows.sort((a, b) =>
    b.traded_at.localeCompare(a.traded_at) || b.trade_id - a.trade_id,
  );
}

export default function TradesView() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [unlinking, setUnlinking] = useState<number | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState<number | null>(null);
  const [unlinkError, setUnlinkError] = useState<{ tradeId: number; message: string } | null>(null);

  const trades = useSupabaseQuery<TradeRow[]>("trades:list", async () => {
    return fetchTrades(createClient());
  });

  const unlink = useCallback(async (tradeId: number) => {
    setUnlinkError(null);
    setUnlinking(tradeId);
    try {
      const { error } = await createClient().rpc("unlink_trade", { p_trade_id: tradeId });
      if (error) throw error;
      await trades.retry();
    } catch (error) {
      setUnlinkError({
        tradeId,
        message: t("trades.unlinkError", { error: formatMutationError(error) }),
      });
    } finally {
      setUnlinking(null);
    }
  }, [t, trades]);

  if (trades.error) return <div className="p-4"><QueryError error={trades.error} onRetry={trades.retry} /></div>;

  const rows = trades.data ?? [];

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <p className="max-w-prose text-sm text-muted-foreground">{t("trades.intro")}</p>
        <Button className="min-h-11 sm:min-h-9" onClick={() => setOpen(true)}>
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
            <li key={r.trade_id} className="space-y-2 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {r.counterparty || t("trades.noCounterparty")}
                    <span className="ml-2 font-normal text-muted-foreground">{formatDate(r.traded_at, language)}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t("trades.sidesSummary", {
                      out: formatUsd(r.value_out_usd),
                      sale: String(r.sale_group),
                      in: formatUsd(r.value_in_usd),
                      lot: String(r.lot_id),
                    })}
                  </p>
                </div>
                {r.cash_usd !== 0 && (
                  <Badge variant="outline" className="tabular-nums">
                    {r.cash_usd > 0
                      ? t("trades.cashPaidBadge", { amount: formatUsd(r.cash_usd) })
                      : t("trades.cashReceivedBadge", { amount: formatUsd(Math.abs(r.cash_usd)) })}
                  </Badge>
                )}
                {/* Both sides are mandatory and the RPC refuses an imbalance, so a
                    false here means something drifted after the fact. Shown rather
                    than assumed away. */}
                {!r.balanced && (
                  <Badge variant="outline" className="border-destructive/50 text-destructive">
                    <TriangleAlert className="mr-1 size-3" aria-hidden />
                    {t("trades.outOfBalance", { amount: formatUsd(r.imbalance_usd) })}
                  </Badge>
                )}
                <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9"
                  disabled={unlinking != null} onClick={() => setConfirmUnlink(r.trade_id)}>
                  <Link2Off className="mr-1 size-4" aria-hidden />
                  {t("trades.unlink")}
                </Button>
              </div>
              {unlinkError?.tradeId === r.trade_id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p role="alert" className="text-sm text-destructive">{unlinkError.message}</p>
                  <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={() => setConfirmUnlink(r.trade_id)}>
                    {t("common.retry")}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={confirmUnlink != null} onOpenChange={(nextOpen) => {
        if (!nextOpen) setConfirmUnlink(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("trades.unlinkTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("trades.unlinkHint")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={unlinking != null}
              onClick={() => {
                const tradeId = confirmUnlink;
                setConfirmUnlink(null);
                if (tradeId != null) void unlink(tradeId);
              }}
            >
              {t("trades.unlink")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
  const { language } = useLanguage();
  const [saving, setSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
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
      const [taken, sales, lots] = await Promise.all([
        selectAll<{ trade_id: number; sale_group: number; lot_id: number }>(
          () => supabase.from("trades").select("trade_id, sale_group, lot_id"),
          ["trade_id"],
        ),
        selectAll<SaleOption>(
          () => supabase.from("sale_lots")
            .select("sale_group, sold_at, gross_proceeds_usd, leg")
            .eq("status", "finalized"),
          ["sold_at", "sale_group"],
        ),
        selectAll<LotOption>(
          () => supabase.from("acquisition_lots")
            .select("lot_id, acquired_at, total_cost_usd, shop_label")
            .eq("lines_imported", true),
          ["acquired_at", "lot_id"],
        ),
      ]);
      const usedSales = new Set(taken.map((r) => r.sale_group));
      const usedLots = new Set(taken.map((r) => r.lot_id));
      return {
        sales: sales.filter((s) => !usedSales.has(s.sale_group)).sort((a, b) =>
          b.sold_at.localeCompare(a.sold_at) || b.sale_group - a.sale_group,
        ),
        lots: lots.filter((l) => !usedLots.has(l.lot_id)).sort((a, b) =>
          b.acquired_at.localeCompare(a.acquired_at) || b.lot_id - a.lot_id,
        ),
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
    setSaving(true);
    setMutationError(null);
    try {
      const { error } = await createClient().rpc("link_trade", {
        p_sale_group: saleGroup,
        p_lot_id: lotId,
        p_cash_usd: signedCash(draft),
        p_counterparty: counterparty.trim() || null,
        p_traded_at: null,
        p_notes: notes.trim() || null,
      });
      if (error) throw error;
      props.onRecorded();
    } catch (error) {
      setMutationError(t("trades.linkError", { error: formatMutationError(error) }));
    } finally {
      setSaving(false);
    }
  }, [saleGroup, lotId, draft, counterparty, notes, props, t]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{t("trades.record")}</DialogTitle></DialogHeader>

        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{t("trades.dialogHint")}</p>

          {options.error && <QueryError error={options.error} onRetry={options.retry} />}
          {mutationError && <p role="alert" className="text-sm text-destructive">{mutationError}</p>}

          <label className="block space-y-1">
            <span className="text-xs font-medium">{t("trades.gaveLabel")}</span>
            <select className="min-h-11 w-full rounded-md border bg-background px-2 text-sm sm:min-h-9"
              value={saleGroup ?? ""} onChange={(e) => setSaleGroup(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t("trades.pickSale")}</option>
              {(options.data?.sales ?? []).map((s) => (
                <option key={s.sale_group} value={s.sale_group}>
                  #{s.sale_group} · {formatDate(s.sold_at, language)} · {formatUsd(Number(s.gross_proceeds_usd))}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium">{t("trades.gotLabel")}</span>
            <select className="min-h-11 w-full rounded-md border bg-background px-2 text-sm sm:min-h-9"
              value={lotId ?? ""} onChange={(e) => setLotId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t("trades.pickLot")}</option>
              {(options.data?.lots ?? []).map((l) => (
                <option key={l.lot_id} value={l.lot_id}>
                  #{l.lot_id} · {formatDate(l.acquired_at, language)} · {formatUsd(Number(l.total_cost_usd))}{l.shop_label ? ` · ${l.shop_label}` : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium">{t("trades.cashDirection")}</span>
              <select className="min-h-11 w-full rounded-md border bg-background px-2 text-sm sm:min-h-9"
                value={direction} onChange={(e) => setDirection(e.target.value as CashDirection)}>
                <option value="none">{t("trades.cashNone")}</option>
                <option value="paid">{t("trades.cashPaid")}</option>
                <option value="received">{t("trades.cashReceived")}</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium">{t("trades.cashAmount")}</span>
              <Input className="min-h-11 sm:min-h-9" type="number" step="0.01" min="0" value={cashAmount} disabled={direction === "none"}
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
                <p>{t("trades.balanceOut", { amount: formatUsd(draft.valueOutUsd ?? 0) })}</p>
                <p>{t("trades.balanceCash", { amount: formatUsd(signedCash(draft)) })}</p>
                <p className="border-t pt-1">
                  {t("trades.balanceExpected", { amount: formatUsd(balance.expectedIn ?? 0) })}
                </p>
                <p>{t("trades.balanceActual", { amount: formatUsd(draft.valueInUsd ?? 0) })}</p>
                <p className={balance.balanced ? "font-semibold text-green-700 dark:text-green-400" : "font-semibold text-amber-700 dark:text-amber-400"}>
                  {balance.balanced
                    ? t("trades.balances")
                    : t("trades.doesNotBalance", { amount: formatUsd(balance.imbalance ?? 0) })}
                </p>
                {!balance.balanced && draft.valueOutUsd != null && (
                  <p className="text-muted-foreground">
                    {t("trades.balanceFixHint", {
                      amount: formatUsd(deriveValueIn(draft.valueOutUsd, signedCash(draft))),
                    })}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium">{t("trades.counterparty")}</span>
              <Input className="min-h-11 sm:min-h-9" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium">{t("trades.notes")}</span>
              <Input className="min-h-11 sm:min-h-9" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>

        </div>

        <DialogFooter>
          <Button className="min-h-11 sm:min-h-9" disabled={saving || !balance.balanced || saleGroup == null || lotId == null} onClick={submit}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            <span className="ml-1">{t("trades.record")}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
