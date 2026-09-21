"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatJpy } from "@/lib/money";

// What the buying agent holds, on his own screen, in yen.
//
// He is the one who finds out first that a shop cancelled, so he has to be
// able to see what the balance claims he is holding and say when it is wrong.
//
// Yen and nothing else. What the transfer cost, the rate it moved at and the
// account it came from are the operator's side of the same event, and none of
// them is a number he can act on. That is not enforced here: he reads
// buyer_float_self_v, which has no USD column to render even if this file
// asked for one.

type Float = {
  remitted_jpy: number;
  spent_jpy: number;
  fees_jpy: number;
  refunded_jpy: number;
  settled_jpy: number;
  balance_jpy: number;
};

type Movement = {
  entry_id: number;
  kind: string;
  amount_jpy: number;
  occurred_at: string;
  note: string | null;
};

// From his side, not the books'. "Sent to you" is what happened to him; the
// operator's word for the same row is "remittance".
const KIND_LABEL: Record<string, string> = {
  remittance: "Sent to you",
  refund: "Refunded to you",
  settlement: "Returned by you",
};

export default function BuyerFloatStrip() {
  const [state, setState] = useState<Float | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    void supabase.from("buyer_float_self_v").select("*").maybeSingle()
      .then(({ data }) => setState(data as Float | null));
    void supabase.from("buyer_float_self_entries_v").select("*").limit(20)
      .then(({ data }) => setMovements((data ?? []) as Movement[]));
  }, []);

  // No float, no strip. An agent who has never been sent money should not be
  // shown a row of zeroes he has to interpret.
  if (!state || (state.remitted_jpy === 0 && state.spent_jpy === 0)) return null;

  const spentTotal = Number(state.spent_jpy) + Number(state.fees_jpy);

  return (
    <section className="border-b bg-muted/30 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">You are holding</div>
          <div className="text-2xl font-semibold tabular-nums">{formatJpy(state.balance_jpy)}</div>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <div className="flex gap-2">
            <dt>Sent to you</dt>
            <dd className="tabular-nums text-foreground">{formatJpy(state.remitted_jpy)}</dd>
          </div>
          <div className="flex gap-2">
            <dt>Spent</dt>
            <dd className="tabular-nums text-foreground">{formatJpy(spentTotal)}</dd>
          </div>
          {Number(state.refunded_jpy) > 0 ? (
            <div className="flex gap-2">
              <dt>Refunded</dt>
              <dd className="tabular-nums text-foreground">{formatJpy(state.refunded_jpy)}</dd>
            </div>
          ) : null}
          {Number(state.settled_jpy) > 0 ? (
            <div className="flex gap-2">
              <dt>Returned</dt>
              <dd className="tabular-nums text-foreground">{formatJpy(state.settled_jpy)}</dd>
            </div>
          ) : null}
        </dl>
        {movements.length > 0 ? (
          <button
            type="button"
            className="ml-auto cursor-pointer text-sm underline underline-offset-2 text-muted-foreground hover:text-foreground"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Hide history" : "History"}
          </button>
        ) : null}
      </div>

      {open ? (
        <ul className="mt-3 space-y-1 text-sm">
          {movements.map((m) => (
            <li key={m.entry_id} className="flex flex-wrap items-baseline gap-x-3">
              <span className="tabular-nums text-muted-foreground">{m.occurred_at}</span>
              <span>{KIND_LABEL[m.kind] ?? m.kind}</span>
              <span className="tabular-nums font-medium">{formatJpy(m.amount_jpy)}</span>
              {m.note ? <span className="text-muted-foreground">{m.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-2 text-xs text-muted-foreground">
        Leftover money stays with you for the next order. Tell the operator if this does not match what you hold.
      </p>
    </section>
  );
}
