// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  clearSellLotDraft,
  draftHasContent,
  loadSellLotDraft,
  saveSellLotDraft,
  type SellLotDraft,
} from "./sell-lot-draft";

function draft(over: Partial<SellLotDraft> = {}): SellLotDraft {
  return {
    selected: ["pokemon-1-2-0-import"],
    lotQty: { "pokemon-1-2-0-import": "2" },
    lotGross: "100",
    lotFees: "5",
    lotCurrency: "USD",
    lotFx: "1",
    lotDate: "2026-08-08",
    lotAllocationMethod: "market_value",
    lotExpenseCategory: "platform_fee",
    lotItemExpenses: {},
    lotItemExpenseCategories: {},
    lotExplicitGross: {},
    lotCustomerId: null,
    lotOpen: true,
    savedAt: 1,
    ...over,
  };
}

afterEach(() => window.localStorage.clear());

describe("sell-lot draft persistence", () => {
  it("round-trips a draft scoped by trip", () => {
    saveSellLotDraft(4, draft());
    const back = loadSellLotDraft(4);
    expect(back?.selected).toEqual(["pokemon-1-2-0-import"]);
    expect(back?.lotGross).toBe("100");
    expect(back?.lotOpen).toBe(true);
    // A different trip has its own draft slot.
    expect(loadSellLotDraft(5)).toBeNull();
  });

  it("clears a draft", () => {
    saveSellLotDraft(4, draft());
    clearSellLotDraft(4);
    expect(loadSellLotDraft(4)).toBeNull();
  });

  it("returns null on absent or corrupt storage", () => {
    expect(loadSellLotDraft(99)).toBeNull();
    window.localStorage.setItem("tcg:selllot-draft:v1:7", "{not json");
    expect(loadSellLotDraft(7)).toBeNull();
  });

  it("treats a draft as content only with a selection or a gross", () => {
    expect(draftHasContent({ selected: [], lotGross: "" })).toBe(false);
    expect(draftHasContent({ selected: [], lotGross: "   " })).toBe(false);
    expect(draftHasContent({ selected: ["x"], lotGross: "" })).toBe(true);
    expect(draftHasContent({ selected: [], lotGross: "50" })).toBe(true);
  });
});
