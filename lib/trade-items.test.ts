import { describe, expect, it } from "vitest";

import {
  canRecordTrade,
  itemProblems,
  itemsInPayload,
  itemsOutPayload,
  type TradeItemDraft,
} from "./trade-items";

function single(over: Partial<TradeItemDraft> = {}): TradeItemDraft {
  return {
    key: "k1",
    game: "pokemon",
    itemId: 794020,
    conditionId: 1,
    psaGrade: 0,
    quantity: 1,
    label: "Pikachu",
    ...over,
  };
}

describe("payload shape", () => {
  it("sends a single as card_id with its condition", () => {
    expect(itemsOutPayload([single()])).toEqual([
      { game: "pokemon", kind: "single", card_id: 794020, condition_id: 1, psa_grade: 0, quantity: 1 },
    ]);
  });

  it("sends sealed as product_id with its condition and edition, not condition_id", () => {
    const [row] = itemsOutPayload([
      single({ game: "pokemon_sealed", itemId: 55, conditionId: null, sealedCondition: "shrink" }),
    ]);
    expect(row).toEqual({
      game: "pokemon_sealed",
      kind: "sealed",
      product_id: 55,
      quantity: 1,
      sealed_condition: "shrink",
      variant_edition: "standard",
    });
    expect(row).not.toHaveProperty("condition_id");
  });

  it("keeps mtg on its own game so the RPC picks mtg_lot_lines", () => {
    expect(itemsOutPayload([single({ game: "mtg", itemId: 358163, conditionId: 6 })])[0]).toMatchObject({
      game: "mtg",
      card_id: 358163,
      condition_id: 6,
    });
  });
});

describe("incoming market value", () => {
  // finalize_acquisition_lot splits the lot total by market value, so a value
  // is a proposal for a card the engine cannot price - never a requirement.
  it("is omitted entirely when not given, so the engine prices the line", () => {
    expect(itemsInPayload([single()])[0]).not.toHaveProperty("market_value_usd");
  });

  it("is omitted when zero or negative rather than pinning a line to nothing", () => {
    expect(itemsInPayload([single({ marketValueUsd: 0 })])[0]).not.toHaveProperty("market_value_usd");
    expect(itemsInPayload([single({ marketValueUsd: -5 })])[0]).not.toHaveProperty("market_value_usd");
  });

  it("is carried when given", () => {
    expect(itemsInPayload([single({ marketValueUsd: 150 })])[0]).toMatchObject({ market_value_usd: 150 });
  });

  it("is never sent on the outgoing side, whose value is the agreed total", () => {
    expect(itemsOutPayload([single({ marketValueUsd: 150 })])[0]).not.toHaveProperty("market_value_usd");
  });
});

describe("itemProblems", () => {
  it("rejects a non-positive or fractional quantity", () => {
    expect(itemProblems([single({ quantity: 0 })], false)[0].reason).toBe("quantity");
    expect(itemProblems([single({ quantity: -1 })], false)[0].reason).toBe("quantity");
    expect(itemProblems([single({ quantity: 1.5 })], false)[0].reason).toBe("quantity");
  });

  it("rejects giving away more than we hold, but only on the outgoing side", () => {
    const over = [single({ quantity: 3, available: 2 })];
    expect(itemProblems(over, true)[0].reason).toBe("oversold");
    // The incoming side has no holding to exceed.
    expect(itemProblems(over, false)).toEqual([]);
  });

  it("allows giving away exactly what we hold", () => {
    expect(itemProblems([single({ quantity: 2, available: 2 })], true)).toEqual([]);
  });

  it("requires a condition for a single but not for sealed", () => {
    expect(itemProblems([single({ conditionId: null })], false)[0].reason).toBe("condition");
    expect(
      itemProblems([single({ game: "pokemon_sealed", conditionId: null })], false),
    ).toEqual([]);
  });
});

describe("canRecordTrade", () => {
  const ok = { itemsOut: [single()], itemsIn: [single({ key: "k2" })], valueOutUsd: 220, signedCashUsd: 0 };

  it("accepts cards on both sides with a positive value", () => {
    expect(canRecordTrade(ok)).toBe(true);
  });

  it("refuses a one-sided basket, which is a sale or a gift and not a trade", () => {
    expect(canRecordTrade({ ...ok, itemsOut: [] })).toBe(false);
    expect(canRecordTrade({ ...ok, itemsIn: [] })).toBe(false);
  });

  it("refuses a value that is missing or not positive", () => {
    expect(canRecordTrade({ ...ok, valueOutUsd: null })).toBe(false);
    expect(canRecordTrade({ ...ok, valueOutUsd: 0 })).toBe(false);
  });

  it("accepts cash in either direction", () => {
    // We paid cash on top, so the cards coming back are worth more.
    expect(canRecordTrade({ ...ok, signedCashUsd: 80 })).toBe(true);
    // We took cash back, so the cards coming back are worth less.
    expect(canRecordTrade({ ...ok, signedCashUsd: -70 })).toBe(true);
  });

  it("refuses cash back larger than what we gave, which leaves nothing for the cards", () => {
    expect(canRecordTrade({ ...ok, valueOutUsd: 100, signedCashUsd: -100 })).toBe(false);
    expect(canRecordTrade({ ...ok, valueOutUsd: 100, signedCashUsd: -200 })).toBe(false);
  });

  it("refuses a basket with a bad row", () => {
    expect(canRecordTrade({ ...ok, itemsOut: [single({ quantity: 5, available: 1 })] })).toBe(false);
    expect(canRecordTrade({ ...ok, itemsIn: [single({ key: "k2", conditionId: null })] })).toBe(false);
  });
});
