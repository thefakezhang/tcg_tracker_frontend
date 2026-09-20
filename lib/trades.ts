// Pure logic for recording a trade.
//
// A trade is two sides that settle against each other, and the whole reason to
// record it as one event rather than two coincidental ones is the identity:
//
//     value_in = value_out + cash
//
// `cash` is SIGNED: positive when you paid cash on top of the cards you gave,
// negative when you received it. Both happen, and the sign is the only thing
// that distinguishes them.
//
// The backend enforces this in link_trade. It is duplicated here so the form
// can show the arithmetic reconciling as you type, rather than letting you fill
// everything in and then rejecting it.

export type CashDirection = "paid" | "received" | "none";

export interface TradeDraft {
  /** Agreed value of the cards you gave. The sale's gross proceeds. */
  valueOutUsd: number | null;
  /** Agreed value of the cards you received. The acquisition lot's total cost. */
  valueInUsd: number | null;
  /** Always entered as a positive magnitude; direction carries the sign. */
  cashAmount: number | null;
  direction: CashDirection;
}

/** The signed cash the backend wants: + paid, - received, 0 for a pure swap. */
export function signedCash(draft: Pick<TradeDraft, "cashAmount" | "direction">): number {
  if (draft.direction === "none" || draft.cashAmount == null) return 0;
  const magnitude = Math.abs(draft.cashAmount);
  return draft.direction === "paid" ? magnitude : -magnitude;
}

export interface TradeBalance {
  /** value_out + cash: what the received cards must be worth. */
  expectedIn: number | null;
  /** Signed gap. Positive means the inbound lot is costed too high. */
  imbalance: number | null;
  balanced: boolean;
  /** True once both values are present, so "incomplete" is not shown as "wrong". */
  complete: boolean;
}

// Money compared in cents. Comparing numeric dollars with === is how a trade
// that balances to the cent gets reported as unbalanced by 2.2e-16.
const CENTS = 100;
function cents(value: number): number {
  return Math.round(value * CENTS);
}

export function balanceOf(draft: TradeDraft): TradeBalance {
  const { valueOutUsd, valueInUsd } = draft;
  if (valueOutUsd == null || valueInUsd == null) {
    return { expectedIn: null, imbalance: null, balanced: false, complete: false };
  }
  const expectedIn = valueOutUsd + signedCash(draft);
  const imbalance = (cents(valueInUsd) - cents(expectedIn)) / CENTS;
  return { expectedIn, imbalance, balanced: imbalance === 0, complete: true };
}

// The value the OTHER side must carry, so the form can offer to fill it in
// rather than making you do the arithmetic. Derived from the same identity,
// rearranged.
export function deriveValueIn(valueOutUsd: number, signed: number): number {
  return valueOutUsd + signed;
}
export function deriveValueOut(valueInUsd: number, signed: number): number {
  return valueInUsd - signed;
}

/** A trade needs both sides; cash alone is not a trade. */
export function isRecordable(draft: TradeDraft, saleGroup: number | null, lotId: number | null): boolean {
  return saleGroup != null && lotId != null && balanceOf(draft).balanced;
}
