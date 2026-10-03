"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMutationError } from "@/lib/mutation-error";
import { formatDate, localDateInputValue } from "@/lib/dates";
import { formatJpy, formatJpyPerUsd, formatPercent, formatUsd } from "@/lib/money";
import { selectAll } from "@/lib/supabase/select-all";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { useLanguage } from "./LanguageContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// Money held with the buying agent, from the operator's side.
//
// Cash moves before goods do: the operator sends a lump sum, the agent buys
// from it, and whatever is not spent stays with him and funds the next order.
// The balance rolls over, so this reads as a running account per agent rather
// than a per-trip reconciliation that has to land on zero.
//
// The operator sees both currencies because he is the one who pays in USD and
// therefore the only one who can act on the rate or the fee. The agent's own
// screen is JPY-only, and the database enforces that rather than this file:
// buyer_float_balance_v is operator-only, and he reads buyer_float_self_v.

const selectClass =
  "min-h-11 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring sm:min-h-9";

type Balance = {
  buyer_email: string;
  remitted_jpy: number;
  spent_jpy: number;
  fees_jpy: number;
  refunded_jpy: number;
  settled_jpy: number;
  balance_jpy: number;
};

type CashAccount = { account_id: number; code: string; name: string };
type Buyer = { email: string; has_account: boolean };
type Trip = { trip_id: number; name: string };

type Refundable = {
  buyer_email: string;
  plan_line_id: number;
  plan_name: string;
  source: string;
  regional_name: string | null;
  english_name: string | null;
  set_code: string | null;
  card_number: string | null;
  purchased_quantity: number;
  unit_price_jpy: number;
  paid_jpy: number;
  refunded_jpy: number;
  refundable_jpy: number;
};

type Movement = {
  entry_id: number;
  buyer_email: string;
  kind: string;
  amount_jpy: number;
  occurred_at: string;
  note: string | null;
  amount_usd: number | null;
  fee_usd: number | null;
  fx_rate_jpy_per_usd: number | null;
};

const KIND_LABEL: Record<string, TranslationKey> = {
  remittance: "buyerFloat.kindSent",
  refund: "buyerFloat.kindRefunded",
  settlement: "buyerFloat.kindReturned",
};

type ReadSource = "balances" | "movements" | "accounts" | "buyers" | "trips" | "refundable";
type ReadFailure = { source: ReadSource; message: string };

const num = (v: string) => (v.trim() === "" ? null : Number(v));

export default function BuyerFloatView() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [refundable, setRefundable] = useState<Refundable[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [readErrors, setReadErrors] = useState<ReadFailure[]>([]);

  const [buyer, setBuyer] = useState("");
  const [cashCode, setCashCode] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [feeUsd, setFeeUsd] = useState("");
  const [amountJpy, setAmountJpy] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => localDateInputValue());
  const [tripId, setTripId] = useState<number | null>(null);
  const [note, setNote] = useState("");

  const [refundLine, setRefundLine] = useState<number | null>(null);
  const [refundJpy, setRefundJpy] = useState("");
  const [settleBuyer, setSettleBuyer] = useState("");
  const [settleJpy, setSettleJpy] = useState("");
  const [remitRequestId, setRemitRequestId] = useState(() => crypto.randomUUID());
  const [refundRequestId, setRefundRequestId] = useState(() => crypto.randomUUID());
  const [settleRequestId, setSettleRequestId] = useState(() => crypto.randomUUID());

  const load = useCallback(async () => {
    const supabase = createClient();
    const failures: ReadFailure[] = [];
    const safe = async <T,>(source: ReadSource, read: () => Promise<T[]>): Promise<T[]> => {
      try {
        return await read();
      } catch (readError) {
        failures.push({ source, message: formatMutationError(readError) });
        return [];
      }
    };
    const [balanceRows, movementRows, cash, buyerRows, tripRows, refundableRows] = await Promise.all([
      safe<Balance>("balances", () => selectAll<Balance>(
        () => supabase.from("buyer_float_balance_v").select("*"),
        ["buyer_email"],
      )),
      safe<Movement>("movements", () => selectAll<Movement>(
        () => supabase.from("buyer_float_entries")
          .select("entry_id, buyer_email, kind, amount_jpy, occurred_at, note, amount_usd, fee_usd, fx_rate_jpy_per_usd"),
        ["entry_id"],
      )),
      safe<CashAccount>("accounts", () => selectAll<CashAccount>(
        () => supabase.from("gl_accounts").select("account_id, code, name")
          .eq("is_cash", true).eq("is_active", true),
        ["account_id"],
      )),
      safe<Buyer>("buyers", () => selectAll<Buyer>(
        () => supabase.rpc("assignable_buyers"),
        ["email"],
      )),
      safe<Trip>("trips", () => selectAll<Trip>(
        () => supabase.from("trips").select("trip_id, name"),
        ["trip_id"],
      )),
      safe<Refundable>("refundable", () => selectAll<Refundable>(
        () => supabase.from("buyer_float_refundable_lines_v").select("*"),
        ["plan_line_id"],
      )),
    ]);
    setReadErrors(failures);
    setBalances(balanceRows.sort((a, b) => b.balance_jpy - a.balance_jpy));
    setMovements(movementRows.sort((a, b) => b.entry_id - a.entry_id));
    setAccounts(cash);
    setBuyers(buyerRows);
    setTrips(tripRows.sort((a, b) => b.trip_id - a.trip_id));
    setRefundable(refundableRows.sort((a, b) => b.plan_line_id - a.plan_line_id));
    setCashCode((prev) =>
      cash.some((account) => account.code === prev)
        ? prev
        : cash.find((account) => /wise/i.test(account.name))?.code || cash[0]?.code || "",
    );
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The rate is shown, never entered. It is a consequence of what left the
  // account and what arrived, so asking for it as a third number invites a set
  // of three that do not agree - and then the books and the agent disagree too.
  const net = useMemo(() => {
    const a = num(amountUsd), f = num(feeUsd) ?? 0;
    return a == null ? null : a - f;
  }, [amountUsd, feeUsd]);

  const rate = useMemo(() => {
    const jpy = num(amountJpy);
    return net && net > 0 && jpy ? jpy / net : null;
  }, [net, amountJpy]);

  const feePct = useMemo(() => {
    const a = num(amountUsd), f = num(feeUsd);
    return a && a > 0 && f && f > 0 ? (f / a) * 100 : null;
  }, [amountUsd, feeUsd]);

  const remit = async () => {
    setError(null); setSent(null); setBusy(true);
    try {
      const { error: mutationError } = await createClient().rpc("remit_to_buyer", {
        p_request_id: remitRequestId,
        p_buyer_email: buyer,
        p_cash_account: cashCode,
        p_amount_usd: num(amountUsd),
        p_fee_usd: num(feeUsd) ?? 0,
        p_amount_jpy: num(amountJpy),
        p_occurred_at: occurredAt,
        p_trip_id: tripId,
        p_note: note.trim() || null,
      });
      if (mutationError) throw mutationError;
      setSent(t("buyerFloat.sentConfirmation", {
        amount: formatJpy(num(amountJpy) ?? 0), buyer,
      }));
      setAmountUsd(""); setFeeUsd(""); setAmountJpy(""); setNote("");
      setRemitRequestId(crypto.randomUUID());
      await load();
    } catch (mutationError) {
      setError(formatMutationError(mutationError));
    } finally {
      setBusy(false);
    }
  };

  // The cancellation and the return of cash. Both are movements the system
  // cannot derive: only the agent knows a shop cancelled, and only the operator
  // knows cash came back.
  const refundTarget = refundable.find((r) => r.plan_line_id === refundLine) ?? null;

  const refund = async () => {
    if (refundLine == null) return;
    setError(null); setSent(null); setBusy(true);
    try {
      const { error: mutationError } = await createClient().rpc("refund_buyer_float", {
        p_request_id: refundRequestId,
        p_plan_line_id: refundLine,
        p_amount_jpy: num(refundJpy),
        p_occurred_at: occurredAt,
        p_note: note.trim() || null,
      });
      if (mutationError) throw mutationError;
      setSent(t("buyerFloat.creditConfirmation", { amount: formatJpy(num(refundJpy) ?? 0) }));
      setRefundLine(null); setRefundJpy("");
      setRefundRequestId(crypto.randomUUID());
      await load();
    } catch (mutationError) {
      setError(formatMutationError(mutationError));
    } finally {
      setBusy(false);
    }
  };

  const settle = async () => {
    setError(null); setSent(null); setBusy(true);
    try {
      const { error: mutationError } = await createClient().rpc("settle_buyer_float", {
        p_request_id: settleRequestId,
        p_buyer_email: settleBuyer,
        p_amount_jpy: num(settleJpy),
        p_occurred_at: occurredAt,
        p_trip_id: null,
        p_note: null,
      });
      if (mutationError) throw mutationError;
      setSent(t("buyerFloat.returnedConfirmation", {
        amount: formatJpy(num(settleJpy) ?? 0), buyer: settleBuyer,
      }));
      setSettleJpy("");
      setSettleRequestId(crypto.randomUUID());
      await load();
    } catch (mutationError) {
      setError(formatMutationError(mutationError));
    } finally {
      setBusy(false);
    }
  };

  const canSend =
    !busy && buyer !== "" && cashCode !== "" &&
    (num(amountUsd) ?? 0) > 0 && (num(amountJpy) ?? 0) > 0 && (net ?? 0) > 0;
  const settleBalance = balances?.find((row) => row.buyer_email === settleBuyer)?.balance_jpy ?? 0;

  return (
    <div className="space-y-4">
      {readErrors.length > 0 ? (
        <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {readErrors.map((readError) => (
            <p key={readError.source}>
              {t("buyerFloat.readError", {
                source: t(`buyerFloat.source.${readError.source}` as TranslationKey),
                error: readError.message,
              })}
            </p>
          ))}
          <Button variant="outline" className="min-h-11" onClick={() => void load()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : null}
      <Card>
        <CardHeader><CardTitle>{t("buyerFloat.sendTitle")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="float-buyer">{t("buyerFloat.sendTo")}</Label>
              <select id="float-buyer" className={selectClass} value={buyer} onChange={(e) => setBuyer(e.target.value)}>
                <option value="">{t("buyerFloat.selectAgent")}</option>
                {buyers.map((b) => <option key={b.email} value={b.email}>{b.email}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-account">{t("buyerFloat.from")}</Label>
              <select id="float-account" className={selectClass} value={cashCode} onChange={(e) => setCashCode(e.target.value)}
                      disabled={accounts.length === 0}>
                {accounts.length === 0
                  ? <option value="">{t("buyerFloat.noCashAccount")}</option>
                  : accounts.map((a) => <option key={a.account_id} value={a.code}>{a.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-usd">{t("buyerFloat.leftAccountUsd")}</Label>
              <Input id="float-usd" className="min-h-11 sm:min-h-9" inputMode="decimal" value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} placeholder="1000.00" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-fee">{t("buyerFloat.transferFeeUsd")}</Label>
              <Input id="float-fee" className="min-h-11 sm:min-h-9" inputMode="decimal" value={feeUsd} onChange={(e) => setFeeUsd(e.target.value)} placeholder="6.50" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-jpy">{t("buyerFloat.receivedJpy")}</Label>
              <Input id="float-jpy" className="min-h-11 sm:min-h-9" inputMode="numeric" value={amountJpy} onChange={(e) => setAmountJpy(e.target.value)} placeholder="150000" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-date">{t("buyerFloat.date")}</Label>
              <Input id="float-date" className="min-h-11 sm:min-h-9" type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-trip">{t("buyerFloat.trip")}</Label>
              <select id="float-trip" className={selectClass} value={tripId ?? ""} onChange={(e) => setTripId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">{t("buyerFloat.noTrip")}</option>
                {trips.map((tr) => <option key={tr.trip_id} value={tr.trip_id}>{tr.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-note">{t("buyerFloat.note")}</Label>
              <Input id="float-note" className="min-h-11 sm:min-h-9" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("buyerFloat.optional")} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            {rate ? (
              <span>
                {t("buyerFloat.rate")} <span className="font-medium tabular-nums text-foreground">{formatJpyPerUsd(rate)}</span>
              </span>
            ) : null}
            {feePct != null ? (
              <span>
                {t("buyerFloat.feeIs")} <span className="font-medium tabular-nums text-foreground">{formatPercent(feePct)}</span>{" "}
                {t("buyerFloat.ofTransfer")}
              </span>
            ) : null}
            <Button className="ml-auto min-h-11" disabled={!canSend} onClick={() => void remit()}>
              {busy ? t("buyerFloat.sending") : t("buyerFloat.recordRemittance")}
            </Button>
          </div>

          {sent ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{sent}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("buyerFloat.cancelTitle")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("buyerFloat.cancelIntro")}
            </p>
            <div className="space-y-1">
              <Label htmlFor="refund-line">{t("buyerFloat.purchase")}</Label>
              <select
                id="refund-line" className={selectClass}
                value={refundLine ?? ""}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  setRefundLine(id);
                  const target = refundable.find((r) => r.plan_line_id === id);
                  setRefundJpy(target ? String(target.refundable_jpy) : "");
                }}
              >
                <option value="">{t("buyerFloat.selectPurchase")}</option>
                {refundable.map((r) => (
                  <option key={r.plan_line_id} value={r.plan_line_id}>
                    {t("buyerFloat.purchaseOption", {
                      item: r.regional_name ?? r.english_name ?? t("buyerFloat.line", { id: r.plan_line_id }),
                      source: r.source,
                      quantity: r.purchased_quantity,
                      remaining: formatJpy(r.refundable_jpy),
                      buyer: r.buyer_email,
                    })}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="refund-jpy">{t("buyerFloat.creditBackJpy")}</Label>
              <Input id="refund-jpy" className="min-h-11 sm:min-h-9" inputMode="numeric" value={refundJpy} onChange={(e) => setRefundJpy(e.target.value)} />
            </div>
            <div className="flex items-center gap-3">
              <Button className="min-h-11"
                variant="secondary"
                disabled={busy || refundTarget == null || (num(refundJpy) ?? 0) <= 0 ||
                          (num(refundJpy) ?? 0) > (refundTarget?.refundable_jpy ?? 0)}
                onClick={() => void refund()}
              >
                {t("buyerFloat.recordCancellation")}
              </Button>
              {refundTarget ? (
                <span className="text-sm text-muted-foreground">
                  {t("buyerFloat.paid", { amount: formatJpy(refundTarget.paid_jpy) })}
                  {refundTarget.refunded_jpy > 0
                    ? t("buyerFloat.alreadyCredited", { amount: formatJpy(refundTarget.refunded_jpy) })
                    : ""}
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("buyerFloat.returnTitle")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("buyerFloat.returnIntro")}
            </p>
            <div className="space-y-1">
              <Label htmlFor="settle-buyer">{t("buyerFloat.returnedBy")}</Label>
              <select id="settle-buyer" className={selectClass} value={settleBuyer} onChange={(e) => setSettleBuyer(e.target.value)}>
                <option value="">{t("buyerFloat.selectAgent")}</option>
                {(balances ?? []).map((b) => (
                  <option key={b.buyer_email} value={b.buyer_email}>
                    {t("buyerFloat.agentHolding", { buyer: b.buyer_email, amount: formatJpy(b.balance_jpy) })}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="settle-jpy">{t("buyerFloat.returnedJpy")}</Label>
              <Input id="settle-jpy" className="min-h-11 sm:min-h-9" inputMode="numeric" value={settleJpy} onChange={(e) => setSettleJpy(e.target.value)} />
            </div>
            <Button className="min-h-11"
              variant="secondary"
              disabled={busy || settleBuyer === "" || (num(settleJpy) ?? 0) <= 0 ||
                        (num(settleJpy) ?? 0) > settleBalance}
              onClick={() => void settle()}
            >
              {t("buyerFloat.recordReturn")}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>{t("buyerFloat.heldTitle")}</CardTitle></CardHeader>
        <CardContent>
          {balances === null ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : balances.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("buyerFloat.emptyBalance")}
            </p>
          ) : (
            <div className="overflow-x-auto"><Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("buyerFloat.agent")}</TableHead>
                  <TableHead className="text-right">{t("buyerFloat.sent")}</TableHead>
                  <TableHead className="text-right">{t("buyerFloat.refunded")}</TableHead>
                  <TableHead className="text-right">{t("buyerFloat.spent")}</TableHead>
                  <TableHead className="text-right">{t("buyerFloat.fees")}</TableHead>
                  <TableHead className="text-right">{t("buyerFloat.returned")}</TableHead>
                  <TableHead className="text-right">{t("buyerFloat.holding")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balances.map((b) => (
                  <TableRow key={b.buyer_email}>
                    <TableCell className="font-medium">{b.buyer_email}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatJpy(b.remitted_jpy)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatJpy(b.refunded_jpy)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatJpy(b.spent_jpy)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatJpy(b.fees_jpy)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatJpy(b.settled_jpy)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatJpy(b.balance_jpy)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("buyerFloat.movementsTitle")}</CardTitle></CardHeader>
        <CardContent>
          {movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("buyerFloat.emptyMovements")}</p>
          ) : (
            <div className="overflow-x-auto"><Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("buyerFloat.date")}</TableHead>
                  <TableHead>{t("buyerFloat.agent")}</TableHead>
                  <TableHead>{t("buyerFloat.kind")}</TableHead>
                  <TableHead className="text-right">{t("buyerFloat.jpy")}</TableHead>
                  <TableHead className="text-right">{t("buyerFloat.usd")}</TableHead>
                  <TableHead className="text-right">{t("buyerFloat.fee")}</TableHead>
                  <TableHead className="text-right">{t("buyerFloat.rate")}</TableHead>
                  <TableHead>{t("buyerFloat.note")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => (
                  <TableRow key={m.entry_id}>
                    <TableCell className="tabular-nums">{formatDate(m.occurred_at, language)}</TableCell>
                    <TableCell>{m.buyer_email}</TableCell>
                    <TableCell>{KIND_LABEL[m.kind] ? t(KIND_LABEL[m.kind]) : m.kind}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatJpy(m.amount_jpy)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.amount_usd == null ? "—" : formatUsd(m.amount_usd)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.fee_usd == null ? "—" : formatUsd(m.fee_usd)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.fx_rate_jpy_per_usd == null ? "—" : formatJpyPerUsd(Number(m.fx_rate_jpy_per_usd))}</TableCell>
                    <TableCell className="text-muted-foreground">{m.note ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
