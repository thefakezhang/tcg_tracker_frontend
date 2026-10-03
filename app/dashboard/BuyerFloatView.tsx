"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMutationError } from "@/lib/mutation-error";
import { formatDate, localDateInputValue } from "@/lib/dates";
import { formatJpy, formatJpyPerUsd, formatPercent, formatUsd } from "@/lib/money";
import { selectAll } from "@/lib/supabase/select-all";
import { callBuyerFloatRpc } from "@/lib/supabase/buyer-float-rpc";
import {
  clearPendingBuyerFloatRequest,
  createPendingBuyerFloatRequest,
  isBuyerFloatOutcomeUnknown,
  readPendingBuyerFloatRequest,
  requireBuyerFloatVerification,
  writePendingBuyerFloatRequest,
  type BuyerFloatOperation,
  type PendingRefund,
  type PendingRemittance,
  type PendingSettlement,
  type RefundPayload,
  type RemittancePayload,
  type SettlementPayload,
} from "@/lib/buyer-float-pending";
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
  const [busy, setBusy] = useState<BuyerFloatOperation | null>(null);
  const [remitError, setRemitError] = useState<string | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);
  const [remitSent, setRemitSent] = useState<string | null>(null);
  const [refundSent, setRefundSent] = useState<string | null>(null);
  const [settleSent, setSettleSent] = useState<string | null>(null);
  const [readErrors, setReadErrors] = useState<ReadFailure[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [pendingReady, setPendingReady] = useState(false);
  const [pendingStateError, setPendingStateError] = useState<string | null>(null);
  const [pendingRemit, setPendingRemit] = useState<PendingRemittance | null>(null);
  const [pendingRefund, setPendingRefund] = useState<PendingRefund | null>(null);
  const [pendingSettlement, setPendingSettlement] = useState<PendingSettlement | null>(null);

  const [buyer, setBuyer] = useState("");
  const [cashCode, setCashCode] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [feeUsd, setFeeUsd] = useState("");
  const [amountJpy, setAmountJpy] = useState("");
  const [remitOccurredAt, setRemitOccurredAt] = useState(() => localDateInputValue());
  const [tripId, setTripId] = useState<number | null>(null);
  const [remitNote, setRemitNote] = useState("");

  const [refundLine, setRefundLine] = useState<number | null>(null);
  const [refundJpy, setRefundJpy] = useState("");
  const [refundOccurredAt, setRefundOccurredAt] = useState(() => localDateInputValue());
  const [refundNote, setRefundNote] = useState("");
  const [settleBuyer, setSettleBuyer] = useState("");
  const [settleJpy, setSettleJpy] = useState("");
  const [settleOccurredAt, setSettleOccurredAt] = useState(() => localDateInputValue());
  const [settleNote, setSettleNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    const restore = async () => {
      try {
        const { data: { user }, error: identityError } = await createClient().auth.getUser();
        if (identityError) throw identityError;
        if (!user) throw new Error("No authenticated operator");

        const remittance = readPendingBuyerFloatRequest(user.id, "remittance");
        const refundRequest = readPendingBuyerFloatRequest(user.id, "refund");
        const settlement = readPendingBuyerFloatRequest(user.id, "settlement");
        if (cancelled) return;

        setOwnerId(user.id);
        setPendingRemit(remittance);
        setPendingRefund(refundRequest);
        setPendingSettlement(settlement);
        if (remittance) {
          setBuyer(remittance.payload.p_buyer_email);
          setCashCode(remittance.payload.p_cash_account);
          setAmountUsd(String(remittance.payload.p_amount_usd));
          setFeeUsd(String(remittance.payload.p_fee_usd));
          setAmountJpy(String(remittance.payload.p_amount_jpy));
          setRemitOccurredAt(remittance.payload.p_occurred_at);
          setTripId(remittance.payload.p_trip_id);
          setRemitNote(remittance.payload.p_note ?? "");
        }
        if (refundRequest) {
          setRefundLine(refundRequest.payload.p_plan_line_id);
          setRefundJpy(String(refundRequest.payload.p_amount_jpy));
          setRefundOccurredAt(refundRequest.payload.p_occurred_at);
          setRefundNote(refundRequest.payload.p_note ?? "");
        }
        if (settlement) {
          setSettleBuyer(settlement.payload.p_buyer_email);
          setSettleJpy(String(settlement.payload.p_amount_jpy));
          setSettleOccurredAt(settlement.payload.p_occurred_at);
          setSettleNote(settlement.payload.p_note ?? "");
        }
      } catch (restoreError) {
        if (!cancelled) setPendingStateError(formatMutationError(restoreError));
      } finally {
        if (!cancelled) setPendingReady(true);
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, []);

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
    if (failures.length > 0) return;
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
    if (!ownerId) return;
    setRemitError(null);
    setRemitSent(null);
    setBusy("remittance");

    let request: PendingRemittance;
    if (pendingRemit) {
      request = pendingRemit;
    } else {
      const payload: RemittancePayload = {
        p_buyer_email: buyer,
        p_cash_account: cashCode,
        p_amount_usd: num(amountUsd) as number,
        p_fee_usd: num(feeUsd) ?? 0,
        p_amount_jpy: num(amountJpy) as number,
        p_occurred_at: remitOccurredAt,
        p_trip_id: tripId,
        p_note: remitNote.trim() || null,
      };
      request = createPendingBuyerFloatRequest(ownerId, "remittance", payload);
      try {
        writePendingBuyerFloatRequest(request);
        setPendingRemit(request);
      } catch (storageError) {
        setRemitError(t("buyerFloat.pendingWriteError", { error: formatMutationError(storageError) }));
        setBusy(null);
        return;
      }
    }

    let legacyAttempted = request.retryPolicy === "verify";
    try {
      const client = createClient();
      const result = await callBuyerFloatRpc(
        () => client.rpc("remit_to_buyer", { p_request_id: request.requestId, ...request.payload }),
        () => client.rpc("remit_to_buyer", request.payload),
        () => {
          legacyAttempted = true;
          request = requireBuyerFloatVerification(request);
          writePendingBuyerFloatRequest(request);
          setPendingRemit(request);
        },
      );
      if (result.error) {
        if (isBuyerFloatOutcomeUnknown(result.error)) {
          setRemitError(t(
            legacyAttempted ? "buyerFloat.legacyOutcomeUnknown" : "buyerFloat.outcomeUnknown",
            { error: formatMutationError(result.error) },
          ));
        } else {
          clearPendingBuyerFloatRequest(ownerId, "remittance");
          setPendingRemit(null);
          setRemitError(t("buyerFloat.mutationError", { error: formatMutationError(result.error) }));
        }
        return;
      }

      clearPendingBuyerFloatRequest(ownerId, "remittance");
      setPendingRemit(null);
      setRemitSent(t("buyerFloat.sentConfirmation", {
        amount: formatJpy(request.payload.p_amount_jpy),
        buyer: request.payload.p_buyer_email,
      }));
      setAmountUsd("");
      setFeeUsd("");
      setAmountJpy("");
      setRemitNote("");
      setRemitOccurredAt(localDateInputValue());
      await load();
    } catch (mutationError) {
      if (isBuyerFloatOutcomeUnknown(mutationError)) {
        setRemitError(t(
          legacyAttempted ? "buyerFloat.legacyOutcomeUnknown" : "buyerFloat.outcomeUnknown",
          { error: formatMutationError(mutationError) },
        ));
      } else {
        try {
          clearPendingBuyerFloatRequest(ownerId, "remittance");
          setPendingRemit(null);
        } catch {
          // The persisted request remains visible and locked if storage cannot be updated.
        }
        setRemitError(t("buyerFloat.mutationError", { error: formatMutationError(mutationError) }));
      }
    } finally {
      setBusy(null);
    }
  };

  // The cancellation and the return of cash. Both are movements the system
  // cannot derive: only the agent knows a shop cancelled, and only the operator
  // knows cash came back.
  const refundTarget = refundable.find((r) => r.plan_line_id === refundLine) ?? null;

  const refund = async () => {
    if (!ownerId || (refundLine == null && !pendingRefund)) return;
    setRefundError(null);
    setRefundSent(null);
    setBusy("refund");

    let request: PendingRefund;
    if (pendingRefund) {
      request = pendingRefund;
    } else {
      const payload: RefundPayload = {
        p_plan_line_id: refundLine as number,
        p_amount_jpy: num(refundJpy) as number,
        p_occurred_at: refundOccurredAt,
        p_note: refundNote.trim() || null,
      };
      request = createPendingBuyerFloatRequest(ownerId, "refund", payload);
      try {
        writePendingBuyerFloatRequest(request);
        setPendingRefund(request);
      } catch (storageError) {
        setRefundError(t("buyerFloat.pendingWriteError", { error: formatMutationError(storageError) }));
        setBusy(null);
        return;
      }
    }

    let legacyAttempted = request.retryPolicy === "verify";
    try {
      const client = createClient();
      const result = await callBuyerFloatRpc(
        () => client.rpc("refund_buyer_float", { p_request_id: request.requestId, ...request.payload }),
        () => client.rpc("refund_buyer_float", request.payload),
        () => {
          legacyAttempted = true;
          request = requireBuyerFloatVerification(request);
          writePendingBuyerFloatRequest(request);
          setPendingRefund(request);
        },
      );
      if (result.error) {
        if (isBuyerFloatOutcomeUnknown(result.error)) {
          setRefundError(t(
            legacyAttempted ? "buyerFloat.legacyOutcomeUnknown" : "buyerFloat.outcomeUnknown",
            { error: formatMutationError(result.error) },
          ));
        } else {
          clearPendingBuyerFloatRequest(ownerId, "refund");
          setPendingRefund(null);
          setRefundError(t("buyerFloat.mutationError", { error: formatMutationError(result.error) }));
        }
        return;
      }

      clearPendingBuyerFloatRequest(ownerId, "refund");
      setPendingRefund(null);
      setRefundSent(t("buyerFloat.creditConfirmation", {
        amount: formatJpy(request.payload.p_amount_jpy),
      }));
      setRefundLine(null);
      setRefundJpy("");
      setRefundNote("");
      setRefundOccurredAt(localDateInputValue());
      await load();
    } catch (mutationError) {
      if (isBuyerFloatOutcomeUnknown(mutationError)) {
        setRefundError(t(
          legacyAttempted ? "buyerFloat.legacyOutcomeUnknown" : "buyerFloat.outcomeUnknown",
          { error: formatMutationError(mutationError) },
        ));
      } else {
        try {
          clearPendingBuyerFloatRequest(ownerId, "refund");
          setPendingRefund(null);
        } catch {
          // The persisted request remains visible and locked if storage cannot be updated.
        }
        setRefundError(t("buyerFloat.mutationError", { error: formatMutationError(mutationError) }));
      }
    } finally {
      setBusy(null);
    }
  };

  const settle = async () => {
    if (!ownerId) return;
    setSettleError(null);
    setSettleSent(null);
    setBusy("settlement");

    let request: PendingSettlement;
    if (pendingSettlement) {
      request = pendingSettlement;
    } else {
      const payload: SettlementPayload = {
        p_buyer_email: settleBuyer,
        p_amount_jpy: num(settleJpy) as number,
        p_occurred_at: settleOccurredAt,
        p_trip_id: null,
        p_note: settleNote.trim() || null,
      };
      request = createPendingBuyerFloatRequest(ownerId, "settlement", payload);
      try {
        writePendingBuyerFloatRequest(request);
        setPendingSettlement(request);
      } catch (storageError) {
        setSettleError(t("buyerFloat.pendingWriteError", { error: formatMutationError(storageError) }));
        setBusy(null);
        return;
      }
    }

    let legacyAttempted = request.retryPolicy === "verify";
    try {
      const client = createClient();
      const result = await callBuyerFloatRpc(
        () => client.rpc("settle_buyer_float", { p_request_id: request.requestId, ...request.payload }),
        () => client.rpc("settle_buyer_float", request.payload),
        () => {
          legacyAttempted = true;
          request = requireBuyerFloatVerification(request);
          writePendingBuyerFloatRequest(request);
          setPendingSettlement(request);
        },
      );
      if (result.error) {
        if (isBuyerFloatOutcomeUnknown(result.error)) {
          setSettleError(t(
            legacyAttempted ? "buyerFloat.legacyOutcomeUnknown" : "buyerFloat.outcomeUnknown",
            { error: formatMutationError(result.error) },
          ));
        } else {
          clearPendingBuyerFloatRequest(ownerId, "settlement");
          setPendingSettlement(null);
          setSettleError(t("buyerFloat.mutationError", { error: formatMutationError(result.error) }));
        }
        return;
      }

      clearPendingBuyerFloatRequest(ownerId, "settlement");
      setPendingSettlement(null);
      setSettleSent(t("buyerFloat.returnedConfirmation", {
        amount: formatJpy(request.payload.p_amount_jpy),
        buyer: request.payload.p_buyer_email,
      }));
      setSettleJpy("");
      setSettleNote("");
      setSettleOccurredAt(localDateInputValue());
      await load();
    } catch (mutationError) {
      if (isBuyerFloatOutcomeUnknown(mutationError)) {
        setSettleError(t(
          legacyAttempted ? "buyerFloat.legacyOutcomeUnknown" : "buyerFloat.outcomeUnknown",
          { error: formatMutationError(mutationError) },
        ));
      } else {
        try {
          clearPendingBuyerFloatRequest(ownerId, "settlement");
          setPendingSettlement(null);
        } catch {
          // The persisted request remains visible and locked if storage cannot be updated.
        }
        setSettleError(t("buyerFloat.mutationError", { error: formatMutationError(mutationError) }));
      }
    } finally {
      setBusy(null);
    }
  };

  const mutationReady = pendingReady && ownerId != null && pendingStateError == null;
  const canSend = mutationReady && busy == null && pendingRemit?.retryPolicy !== "verify" &&
    (pendingRemit != null || (
      buyer !== "" && cashCode !== "" &&
      (num(amountUsd) ?? 0) > 0 && (num(amountJpy) ?? 0) > 0 && (net ?? 0) > 0
    ));
  const settleBalance = balances?.find((row) => row.buyer_email === settleBuyer)?.balance_jpy ?? 0;
  const canRefund = mutationReady && busy == null && pendingRefund?.retryPolicy !== "verify" && (
    pendingRefund != null || (
      refundTarget != null && (num(refundJpy) ?? 0) > 0 &&
      (num(refundJpy) ?? 0) <= refundTarget.refundable_jpy
    )
  );
  const canSettle = mutationReady && busy == null && pendingSettlement?.retryPolicy !== "verify" && (
    pendingSettlement != null || (
      settleBuyer !== "" && (num(settleJpy) ?? 0) > 0 &&
      (num(settleJpy) ?? 0) <= settleBalance
    )
  );

  const resolvePending = (operation: BuyerFloatOperation) => {
    if (!ownerId) return;
    try {
      clearPendingBuyerFloatRequest(ownerId, operation);
      if (operation === "remittance") {
        setPendingRemit(null);
        setRemitError(null);
      } else if (operation === "refund") {
        setPendingRefund(null);
        setRefundError(null);
      } else {
        setPendingSettlement(null);
        setSettleError(null);
      }
    } catch (storageError) {
      setPendingStateError(formatMutationError(storageError));
    }
  };

  const readErrorNotice = readErrors.length > 0 ? (
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
  ) : null;

  if (balances === null) {
    return (
      <div className="space-y-4">
        {readErrorNotice}
        {readErrors.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {readErrorNotice}
      {pendingStateError ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {t("buyerFloat.pendingStateError", { error: pendingStateError })}
        </p>
      ) : null}
      <Card>
        <CardHeader><CardTitle>{t("buyerFloat.sendTitle")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="float-buyer">{t("buyerFloat.sendTo")}</Label>
              <select id="float-buyer" className={selectClass} value={buyer} onChange={(e) => setBuyer(e.target.value)} disabled={!mutationReady || pendingRemit != null || busy != null}>
                <option value="">{t("buyerFloat.selectAgent")}</option>
                {buyers.map((b) => <option key={b.email} value={b.email}>{b.email}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-account">{t("buyerFloat.from")}</Label>
              <select id="float-account" className={selectClass} value={cashCode} onChange={(e) => setCashCode(e.target.value)}
                      disabled={!mutationReady || pendingRemit != null || busy != null || accounts.length === 0}>
                {accounts.length === 0
                  ? <option value="">{t("buyerFloat.noCashAccount")}</option>
                  : accounts.map((a) => <option key={a.account_id} value={a.code}>{a.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-usd">{t("buyerFloat.leftAccountUsd")}</Label>
              <Input id="float-usd" className="min-h-11 sm:min-h-9" inputMode="decimal" value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} placeholder="1000.00" disabled={!mutationReady || pendingRemit != null || busy != null} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-fee">{t("buyerFloat.transferFeeUsd")}</Label>
              <Input id="float-fee" className="min-h-11 sm:min-h-9" inputMode="decimal" value={feeUsd} onChange={(e) => setFeeUsd(e.target.value)} placeholder="6.50" disabled={!mutationReady || pendingRemit != null || busy != null} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-jpy">{t("buyerFloat.receivedJpy")}</Label>
              <Input id="float-jpy" className="min-h-11 sm:min-h-9" inputMode="numeric" value={amountJpy} onChange={(e) => setAmountJpy(e.target.value)} placeholder="150000" disabled={!mutationReady || pendingRemit != null || busy != null} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-date">{t("buyerFloat.date")}</Label>
              <Input id="float-date" className="min-h-11 sm:min-h-9" type="date" value={remitOccurredAt} onChange={(e) => setRemitOccurredAt(e.target.value)} disabled={!mutationReady || pendingRemit != null || busy != null} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-trip">{t("buyerFloat.trip")}</Label>
              <select id="float-trip" className={selectClass} value={tripId ?? ""} onChange={(e) => setTripId(e.target.value ? Number(e.target.value) : null)} disabled={!mutationReady || pendingRemit != null || busy != null}>
                <option value="">{t("buyerFloat.noTrip")}</option>
                {trips.map((tr) => <option key={tr.trip_id} value={tr.trip_id}>{tr.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-note">{t("buyerFloat.note")}</Label>
              <Input id="float-note" className="min-h-11 sm:min-h-9" value={remitNote} onChange={(e) => setRemitNote(e.target.value)} placeholder={t("buyerFloat.optional")} disabled={!mutationReady || pendingRemit != null || busy != null} />
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
              {busy === "remittance"
                ? t("buyerFloat.sending")
                : pendingRemit
                  ? t("buyerFloat.retryExactRequest")
                  : t("buyerFloat.recordRemittance")}
            </Button>
          </div>

          {pendingRemit && busy !== "remittance" ? (
            <div role="alert" className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p>{remitError ?? t(pendingRemit.retryPolicy === "safe" ? "buyerFloat.pendingSafeRetry" : "buyerFloat.pendingVerify")}</p>
              {pendingRemit.retryPolicy === "verify" ? (
                <Button type="button" variant="outline" className="min-h-11" onClick={() => resolvePending("remittance")}>
                  {t("buyerFloat.markReconciled")}
                </Button>
              ) : null}
            </div>
          ) : remitError ? <p role="alert" className="text-sm text-destructive">{remitError}</p> : null}
          {remitSent ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{remitSent}</p> : null}
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
                disabled={!mutationReady || pendingRefund != null || busy != null}
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
              <Input id="refund-jpy" className="min-h-11 sm:min-h-9" inputMode="numeric" value={refundJpy} onChange={(e) => setRefundJpy(e.target.value)} disabled={!mutationReady || pendingRefund != null || busy != null} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="refund-date">{t("buyerFloat.date")}</Label>
                <Input id="refund-date" className="min-h-11 sm:min-h-9" type="date" value={refundOccurredAt} onChange={(e) => setRefundOccurredAt(e.target.value)} disabled={!mutationReady || pendingRefund != null || busy != null} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="refund-note">{t("buyerFloat.note")}</Label>
                <Input id="refund-note" className="min-h-11 sm:min-h-9" value={refundNote} onChange={(e) => setRefundNote(e.target.value)} placeholder={t("buyerFloat.optional")} disabled={!mutationReady || pendingRefund != null || busy != null} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button className="min-h-11"
                variant="secondary"
                disabled={!canRefund}
                onClick={() => void refund()}
              >
                {pendingRefund ? t("buyerFloat.retryExactRequest") : t("buyerFloat.recordCancellation")}
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
            {pendingRefund && busy !== "refund" ? (
              <div role="alert" className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p>{refundError ?? t(pendingRefund.retryPolicy === "safe" ? "buyerFloat.pendingSafeRetry" : "buyerFloat.pendingVerify")}</p>
                {pendingRefund.retryPolicy === "verify" ? (
                  <Button type="button" variant="outline" className="min-h-11" onClick={() => resolvePending("refund")}>
                    {t("buyerFloat.markReconciled")}
                  </Button>
                ) : null}
              </div>
            ) : refundError ? <p role="alert" className="text-sm text-destructive">{refundError}</p> : null}
            {refundSent ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{refundSent}</p> : null}
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
              <select id="settle-buyer" className={selectClass} value={settleBuyer} onChange={(e) => setSettleBuyer(e.target.value)} disabled={!mutationReady || pendingSettlement != null || busy != null}>
                <option value="">{t("buyerFloat.selectAgent")}</option>
                {balances.map((b) => (
                  <option key={b.buyer_email} value={b.buyer_email}>
                    {t("buyerFloat.agentHolding", { buyer: b.buyer_email, amount: formatJpy(b.balance_jpy) })}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="settle-jpy">{t("buyerFloat.returnedJpy")}</Label>
              <Input id="settle-jpy" className="min-h-11 sm:min-h-9" inputMode="numeric" value={settleJpy} onChange={(e) => setSettleJpy(e.target.value)} disabled={!mutationReady || pendingSettlement != null || busy != null} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="settle-date">{t("buyerFloat.date")}</Label>
                <Input id="settle-date" className="min-h-11 sm:min-h-9" type="date" value={settleOccurredAt} onChange={(e) => setSettleOccurredAt(e.target.value)} disabled={!mutationReady || pendingSettlement != null || busy != null} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="settle-note">{t("buyerFloat.note")}</Label>
                <Input id="settle-note" className="min-h-11 sm:min-h-9" value={settleNote} onChange={(e) => setSettleNote(e.target.value)} placeholder={t("buyerFloat.optional")} disabled={!mutationReady || pendingSettlement != null || busy != null} />
              </div>
            </div>
            <Button className="min-h-11"
              variant="secondary"
              disabled={!canSettle}
              onClick={() => void settle()}
            >
              {pendingSettlement ? t("buyerFloat.retryExactRequest") : t("buyerFloat.recordReturn")}
            </Button>
            {pendingSettlement && busy !== "settlement" ? (
              <div role="alert" className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p>{settleError ?? t(pendingSettlement.retryPolicy === "safe" ? "buyerFloat.pendingSafeRetry" : "buyerFloat.pendingVerify")}</p>
                {pendingSettlement.retryPolicy === "verify" ? (
                  <Button type="button" variant="outline" className="min-h-11" onClick={() => resolvePending("settlement")}>
                    {t("buyerFloat.markReconciled")}
                  </Button>
                ) : null}
              </div>
            ) : settleError ? <p role="alert" className="text-sm text-destructive">{settleError}</p> : null}
            {settleSent ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{settleSent}</p> : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>{t("buyerFloat.heldTitle")}</CardTitle></CardHeader>
        <CardContent>
          {balances.length === 0 && readErrors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("buyerFloat.emptyBalance")}
            </p>
          ) : balances.length > 0 ? (
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
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("buyerFloat.movementsTitle")}</CardTitle></CardHeader>
        <CardContent>
          {movements.length === 0 && readErrors.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("buyerFloat.emptyMovements")}</p>
          ) : movements.length > 0 ? (
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
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
