// The balance identity is the whole point of recording a trade as one event,
// so these pin it in both cash directions and at the boundary where floating
// point would otherwise report a trade that balances to the cent as wrong.
import { describe, it, expect } from "vitest";
import { balanceOf, signedCash, deriveValueIn, deriveValueOut, isRecordable, type TradeDraft } from "./trades";

function draft(over: Partial<TradeDraft> = {}): TradeDraft {
  return {
    valueOutUsd: over.valueOutUsd === undefined ? 100 : over.valueOutUsd,
    valueInUsd: over.valueInUsd === undefined ? 100 : over.valueInUsd,
    cashAmount: over.cashAmount === undefined ? 0 : over.cashAmount,
    direction: over.direction ?? "none",
  };
}

describe("signedCash", () => {
  it("is positive when you paid and negative when you received", () => {
    expect(signedCash({ cashAmount: 400, direction: "paid" })).toBe(400);
    expect(signedCash({ cashAmount: 400, direction: "received" })).toBe(-400);
  });

  it("ignores the sign the user typed, since direction carries it", () => {
    // Typing "-400" in a field labelled "cash received" must not mean +400.
    expect(signedCash({ cashAmount: -400, direction: "received" })).toBe(-400);
    expect(signedCash({ cashAmount: -400, direction: "paid" })).toBe(400);
  });

  it("is zero for a pure card-for-card swap", () => {
    expect(signedCash({ cashAmount: 999, direction: "none" })).toBe(0);
    expect(signedCash({ cashAmount: null, direction: "paid" })).toBe(0);
  });
});

describe("balanceOf", () => {
  it("balances when you gave cards plus cash", () => {
    // gave $100 of cards + $400 cash, got $500 of cards
    const b = balanceOf(draft({ valueOutUsd: 100, valueInUsd: 500, cashAmount: 400, direction: "paid" }));
    expect(b.expectedIn).toBe(500);
    expect(b.imbalance).toBe(0);
    expect(b.balanced).toBe(true);
  });

  it("balances when you gave cards and took cash back", () => {
    // gave $500 of cards, got $100 of cards + $400 cash
    const b = balanceOf(draft({ valueOutUsd: 500, valueInUsd: 100, cashAmount: 400, direction: "received" }));
    expect(b.expectedIn).toBe(100);
    expect(b.balanced).toBe(true);
  });

  it("reports the signed gap so the form can say which way it is out", () => {
    const b = balanceOf(draft({ valueOutUsd: 100, valueInUsd: 500, cashAmount: 50, direction: "paid" }));
    expect(b.expectedIn).toBe(150);
    expect(b.imbalance).toBe(350); // inbound costed 350 too high
    expect(b.balanced).toBe(false);
  });

  it("does not call an incomplete draft unbalanced", () => {
    const b = balanceOf(draft({ valueInUsd: null }));
    expect(b.complete).toBe(false);
    expect(b.balanced).toBe(false);
    expect(b.imbalance).toBeNull();
  });

  it("compares in cents, so a trade that balances to the cent balances", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; this must still balance.
    const b = balanceOf(draft({ valueOutUsd: 0.1, valueInUsd: 0.3, cashAmount: 0.2, direction: "paid" }));
    expect(b.balanced).toBe(true);
  });

  it("still catches a one-cent error", () => {
    const b = balanceOf(draft({ valueOutUsd: 100, valueInUsd: 100.01, cashAmount: 0, direction: "none" }));
    expect(b.balanced).toBe(false);
    expect(b.imbalance).toBeCloseTo(0.01);
  });
});

describe("deriving the other side", () => {
  it("fills in whichever value the operator did not negotiate", () => {
    expect(deriveValueIn(100, 400)).toBe(500);
    expect(deriveValueOut(500, 400)).toBe(100);
    expect(deriveValueIn(500, -400)).toBe(100);
    expect(deriveValueOut(100, -400)).toBe(500);
  });
});

describe("isRecordable", () => {
  it("needs both sides and a balance", () => {
    const ok = draft({ valueOutUsd: 100, valueInUsd: 100 });
    expect(isRecordable(ok, 1, 1)).toBe(true);
    expect(isRecordable(ok, null, 1)).toBe(false);
    expect(isRecordable(ok, 1, null)).toBe(false);
    expect(isRecordable(draft({ valueInUsd: 101 }), 1, 1)).toBe(false);
  });
});
