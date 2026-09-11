import { describe, expect, it } from "vitest";
import {
  planBuyerGridPaste,
  prepareBuyerResult,
  type BuyerGridColumn,
} from "./buyer-result-grid";
import type { BuyerResultRow } from "./buyer-result-autosave";

type Row = BuyerResultRow & { source: string };

const row = (id: number, over: Partial<Row> = {}): Row => ({
  plan_line_id: id,
  source: "shop",
  outcome: "pending",
  purchased_quantity: 0,
  unit_price_jpy: null,
  condition_seen: null,
  note: null,
  ...over,
});

const aliases = new Map([
  ["", "pending"],
  ["bought", "purchased"],
  ["購入した", "purchased"],
  ["sold out", "sold_out"],
]);

function plan(text: string, startColumn: BuyerGridColumn = "outcome") {
  return planBuyerGridPaste({
    rows: [row(1), row(2)],
    startLineId: 1,
    startColumn,
    text,
    frozen: false,
    outcomeAliases: aliases,
  });
}

describe("buyer result grid paste", () => {
  it("validates then maps a complete spreadsheet rectangle", () => {
    const result = plan([
      "Bought\t2\t¥1,200\tLP\tfirst copy",
      "Sold out\t\t\t\tnone left",
    ].join("\n"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edits.map(({ next }) => next)).toEqual([
      row(1, {
        outcome: "purchased",
        purchased_quantity: 2,
        unit_price_jpy: 1200,
        condition_seen: "LP",
        note: "first copy",
      }),
      row(2, { outcome: "sold_out", note: "none left" }),
    ]);
  });

  it("accepts the Japanese result label as the same scoped value", () => {
    const result = plan("購入した\t1\t900\tNM\t確認済み");
    expect(result.ok && result.edits[0].next.outcome).toBe("purchased");
  });

  it("rejects a bad final cell before returning any edits", () => {
    const result = plan([
      "Bought\t2\t1200\tLP\tvalid",
      "Bought\t1\t900\tEXCELLENT\tinvalid",
    ].join("\n"));
    expect(result).toEqual({ ok: false, reason: "invalid-condition" });
  });

  it("explains a ragged or out-of-bounds selection", () => {
    expect(plan("Bought\t1\nSold out")).toEqual({ ok: false, reason: "not-rectangle" });
    expect(plan("1\t900\tLP\tnote\textra", "qty")).toEqual({
      ok: false,
      reason: "outside-grid",
    });
  });

  it("requires a complete purchase and keeps other outcomes empty", () => {
    expect(plan("Bought\t0\t1200")).toEqual({
      ok: false,
      reason: "incomplete-purchase",
    });
    expect(plan("Sold out\t1\t1200")).toEqual({
      ok: false,
      reason: "incomplete-purchase",
    });
  });
});

describe("buyer result row edits", () => {
  it("preserves a zero remaining shared want instead of inventing a purchase quantity", () => {
    const prior = row(1);
    const next = prepareBuyerResult(prior, { outcome: "purchased" }, {
      plannedQuantity: 0,
      askingPriceJpy: 1200,
    });

    expect(next.purchased_quantity).toBe(0);
    expect(next.unit_price_jpy).toBe(1200);
  });

  it("preserves the condition returned by buyer_plan_lines while another cell changes", () => {
    const prior = row(1, {
      outcome: "purchased",
      purchased_quantity: 1,
      unit_price_jpy: 800,
      condition_seen: "LP",
    });
    expect(prepareBuyerResult(prior, { note: "restored row" }).condition_seen).toBe("LP");
  });
});
