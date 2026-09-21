"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMutationError } from "@/lib/mutation-error";
import { formatJpy, formatUsd } from "@/lib/money";
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
  "h-9 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring";

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

const KIND_LABEL: Record<string, string> = {
  remittance: "Sent",
  refund: "Refunded",
  settlement: "Returned",
};

const num = (v: string) => (v.trim() === "" ? null : Number(v));

export default function BuyerFloatView() {
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [refundable, setRefundable] = useState<Refundable[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const [buyer, setBuyer] = useState("");
  const [cashCode, setCashCode] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [feeUsd, setFeeUsd] = useState("");
  const [amountJpy, setAmountJpy] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [tripId, setTripId] = useState<number | null>(null);
  const [note, setNote] = useState("");

  const [refundLine, setRefundLine] = useState<number | null>(null);
  const [refundJpy, setRefundJpy] = useState("");
  const [settleBuyer, setSettleBuyer] = useState("");
  const [settleJpy, setSettleJpy] = useState("");

  const load = useCallback(async () => {
    const supabase = createClient();
    const [bal, mv, acc, by, tr, rf] = await Promise.all([
      supabase.from("buyer_float_balance_v").select("*"),
      supabase.from("buyer_float_entries")
        .select("entry_id, buyer_email, kind, amount_jpy, occurred_at, note, amount_usd, fee_usd, fx_rate_jpy_per_usd")
        .order("occurred_at", { ascending: false }).order("entry_id", { ascending: false }).limit(50),
      supabase.from("gl_accounts").select("account_id, code, name").eq("is_cash", true).eq("is_active", true).order("sort"),
      supabase.rpc("assignable_buyers"),
      supabase.from("trips").select("trip_id, name").order("trip_id", { ascending: false }),
      supabase.from("buyer_float_refundable_lines_v").select("*").order("plan_line_id", { ascending: false }),
    ]);
    // Set the list either way. Returning early here left "Held with agents"
    // on "Loading..." for good, which reads as a slow query rather than a
    // failed one - and the reason was in a line above that scrolls away.
    if (bal.error) setError(formatMutationError(bal.error));
    setBalances(((bal.data ?? []) as Balance[]).sort((a, b) => b.balance_jpy - a.balance_jpy));
    setMovements((mv.data ?? []) as Movement[]);
    const cash = (acc.data ?? []) as CashAccount[];
    setAccounts(cash);
    setBuyers((by.data ?? []) as Buyer[]);
    setTrips((tr.data ?? []) as Trip[]);
    setRefundable((rf.data ?? []) as Refundable[]);
    setCashCode((prev) => prev || cash.find((a) => /wise/i.test(a.name))?.code || cash[0]?.code || "");
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
    const { error } = await createClient().rpc("remit_to_buyer", {
      p_buyer_email: buyer,
      p_cash_account: cashCode,
      p_amount_usd: num(amountUsd),
      p_fee_usd: num(feeUsd) ?? 0,
      p_amount_jpy: num(amountJpy),
      p_occurred_at: occurredAt,
      p_trip_id: tripId,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) { setError(formatMutationError(error)); return; }
    setSent(`Sent ${formatJpy(num(amountJpy) ?? 0)} to ${buyer}`);
    setAmountUsd(""); setFeeUsd(""); setAmountJpy(""); setNote("");
    await load();
  };

  // The cancellation and the return of cash. Both are movements the system
  // cannot derive: only the agent knows a shop cancelled, and only the operator
  // knows cash came back.
  const refundTarget = refundable.find((r) => r.plan_line_id === refundLine) ?? null;

  const refund = async () => {
    if (refundLine == null) return;
    setError(null); setSent(null); setBusy(true);
    const { error } = await createClient().rpc("refund_buyer_float", {
      p_plan_line_id: refundLine,
      p_amount_jpy: num(refundJpy),
      p_occurred_at: occurredAt,
      p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) { setError(formatMutationError(error)); return; }
    setSent(`Credited ${formatJpy(num(refundJpy) ?? 0)} back`);
    setRefundLine(null); setRefundJpy("");
    await load();
  };

  const settle = async () => {
    setError(null); setSent(null); setBusy(true);
    const { error } = await createClient().rpc("settle_buyer_float", {
      p_buyer_email: settleBuyer,
      p_amount_jpy: num(settleJpy),
      p_occurred_at: occurredAt,
      p_trip_id: null,
      p_note: null,
    });
    setBusy(false);
    if (error) { setError(formatMutationError(error)); return; }
    setSent(`${formatJpy(num(settleJpy) ?? 0)} returned by ${settleBuyer}`);
    setSettleJpy("");
    await load();
  };

  const canSend =
    !busy && buyer !== "" && cashCode !== "" &&
    (num(amountUsd) ?? 0) > 0 && (num(amountJpy) ?? 0) > 0 && (net ?? 0) > 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Send money to a buying agent</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="float-buyer">Send to</Label>
              <select id="float-buyer" className={selectClass} value={buyer} onChange={(e) => setBuyer(e.target.value)}>
                <option value="">Select an agent</option>
                {buyers.map((b) => <option key={b.email} value={b.email}>{b.email}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-account">From</Label>
              <select id="float-account" className={selectClass} value={cashCode} onChange={(e) => setCashCode(e.target.value)}
                      disabled={accounts.length === 0}>
                {accounts.length === 0
                  ? <option value="">No cash account</option>
                  : accounts.map((a) => <option key={a.account_id} value={a.code}>{a.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-usd">Left the account (USD)</Label>
              <Input id="float-usd" inputMode="decimal" value={amountUsd} onChange={(e) => setAmountUsd(e.target.value)} placeholder="1000.00" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-fee">Transfer fee (USD)</Label>
              <Input id="float-fee" inputMode="decimal" value={feeUsd} onChange={(e) => setFeeUsd(e.target.value)} placeholder="6.50" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-jpy">He received (JPY)</Label>
              <Input id="float-jpy" inputMode="numeric" value={amountJpy} onChange={(e) => setAmountJpy(e.target.value)} placeholder="150000" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-date">Date</Label>
              <Input id="float-date" type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-trip">Trip</Label>
              <select id="float-trip" className={selectClass} value={tripId ?? ""} onChange={(e) => setTripId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">No trip</option>
                {trips.map((tr) => <option key={tr.trip_id} value={tr.trip_id}>{tr.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="float-note">Note</Label>
              <Input id="float-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            {rate ? (
              <span>
                Rate <span className="font-medium tabular-nums text-foreground">¥{rate.toFixed(2)} / $1</span>
              </span>
            ) : null}
            {feePct != null ? (
              <span>
                Fee is <span className="font-medium tabular-nums text-foreground">{feePct.toFixed(2)}%</span>{" "}
                of the transfer
              </span>
            ) : null}
            <Button className="ml-auto" disabled={!canSend} onClick={() => void remit()}>
              {busy ? "Sending…" : "Record remittance"}
            </Button>
          </div>

          {sent ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{sent}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>A shop cancelled</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Credits the money back to the agent. It points at the purchase it reverses, so if he later
              re-answers that line the credit follows it instead of being counted twice.
            </p>
            <div className="space-y-1">
              <Label htmlFor="refund-line">Purchase</Label>
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
                <option value="">Select a purchase</option>
                {refundable.map((r) => (
                  <option key={r.plan_line_id} value={r.plan_line_id}>
                    {`${r.regional_name ?? r.english_name ?? `Line ${r.plan_line_id}`} - ${r.source} - ${r.purchased_quantity}x - ${formatJpy(r.refundable_jpy)} left (${r.buyer_email})`}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="refund-jpy">Credit back (JPY)</Label>
              <Input id="refund-jpy" inputMode="numeric" value={refundJpy} onChange={(e) => setRefundJpy(e.target.value)} />
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                disabled={busy || refundTarget == null || (num(refundJpy) ?? 0) <= 0 ||
                          (num(refundJpy) ?? 0) > (refundTarget?.refundable_jpy ?? 0)}
                onClick={() => void refund()}
              >
                Record cancellation
              </Button>
              {refundTarget ? (
                <span className="text-sm text-muted-foreground">
                  {formatJpy(refundTarget.paid_jpy)} paid
                  {refundTarget.refunded_jpy > 0 ? `, ${formatJpy(refundTarget.refunded_jpy)} already credited` : ""}
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>He returned cash</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Only when he hands money back. Leftover funds do not need to come back - they roll over and
              fund his next order.
            </p>
            <div className="space-y-1">
              <Label htmlFor="settle-buyer">Returned by</Label>
              <select id="settle-buyer" className={selectClass} value={settleBuyer} onChange={(e) => setSettleBuyer(e.target.value)}>
                <option value="">Select an agent</option>
                {(balances ?? []).map((b) => (
                  <option key={b.buyer_email} value={b.buyer_email}>
                    {`${b.buyer_email} - holding ${formatJpy(b.balance_jpy)}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="settle-jpy">Returned (JPY)</Label>
              <Input id="settle-jpy" inputMode="numeric" value={settleJpy} onChange={(e) => setSettleJpy(e.target.value)} />
            </div>
            <Button
              variant="secondary"
              disabled={busy || settleBuyer === "" || (num(settleJpy) ?? 0) <= 0}
              onClick={() => void settle()}
            >
              Record return
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Held with agents</CardTitle></CardHeader>
        <CardContent>
          {balances === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : balances.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing sent yet. A remittance above starts an agent&rsquo;s running balance.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Refunded</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                  <TableHead className="text-right">Fees</TableHead>
                  <TableHead className="text-right">Returned</TableHead>
                  <TableHead className="text-right">Holding</TableHead>
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
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent movements</CardTitle></CardHeader>
        <CardContent>
          {movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No movements recorded.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">JPY</TableHead>
                  <TableHead className="text-right">USD</TableHead>
                  <TableHead className="text-right">Fee</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((m) => (
                  <TableRow key={m.entry_id}>
                    <TableCell className="tabular-nums">{m.occurred_at}</TableCell>
                    <TableCell>{m.buyer_email}</TableCell>
                    <TableCell>{KIND_LABEL[m.kind] ?? m.kind}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatJpy(m.amount_jpy)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.amount_usd == null ? "—" : formatUsd(m.amount_usd)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.fee_usd == null ? "—" : formatUsd(m.fee_usd)}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.fx_rate_jpy_per_usd == null ? "—" : `¥${Number(m.fx_rate_jpy_per_usd).toFixed(2)}`}</TableCell>
                    <TableCell className="text-muted-foreground">{m.note ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
