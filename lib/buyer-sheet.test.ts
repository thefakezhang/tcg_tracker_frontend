import { describe, expect, it } from "vitest";
import { readSheetRows, sheetNumber, toSheetRows, type SheetLine } from "./buyer-sheet";

const line = (over: Partial<SheetLine> = {}): SheetLine => ({
  plan_line_id: 1, source: "snkrdunk",
  card_name: "カリンのブースター", card_english_name: "Karen's Flareon",
  set_code: "VS", card_number: "089/141", source_listing_url: "https://snkrdunk.test/1",
  planned_quantity: 1, unit_price_orig: 8000,
  outcome: "pending", purchased_quantity: 0, unit_price_jpy: null, note: null, ...over,
});

// He may type the Japanese label, the English one, or the raw value.
const resolve = (s: string) => ({
  "": "pending", "—": "pending",
  "購入した": "purchased", "purchased": "purchased",
  "売り切れ": "sold_out", "見送った": "declined",
}[s.trim()] ?? null);

const row = (over: Record<string, unknown> = {}) => ({
  id: "plan:9#1", outcome: "購入した", qty: 1, unit_paid: 8000, note: "", ...over,
});

describe("taking the list away as a sheet", () => {
  it("stamps every row with its line id and its plan", () => {
    const rows = toSheetRows(9, [line(), line({ plan_line_id: 2 })], () => "—");
    expect(rows.map((r) => r.id)).toEqual(["plan:9#1", "plan:9#2"]);
  });

  it("leaves quantity and price empty on a line he has not bought", () => {
    const [r] = toSheetRows(9, [line()], () => "—");
    expect(r.qty).toBeNull();
    expect(r.unit_paid).toBeNull();
    expect(r.asking).toBe(8000);
  });

  it("exports the exact sealed identity beside the stable line id", () => {
    const [r] = toSheetRows(9, [line({
      game: "pokemon_sealed",
      card_name: "テストボックス",
      card_number: null,
      sealed_condition: "no_shrink",
      variant_edition: "unlimited",
    })], () => "-");
    expect(r.id).toBe("plan:9#1");
    expect(r.condition).toBe("no_shrink");
    expect(r.edition).toBe("unlimited");
  });
});

describe("bringing it back", () => {
  it("writes what he filled in", () => {
    const { updates, problems } = readSheetRows(9, [row()], [line()], resolve);
    expect(problems).toEqual([]);
    expect(updates).toEqual([{
      plan_line_id: 1, outcome: "purchased", purchased_quantity: 1,
      unit_price_jpy: 8000, note: null,
    }]);
  });

  it("does nothing on a re-upload of the same file", () => {
    // He will upload twice when he is unsure it saved. That must be free.
    const already = line({ outcome: "purchased", purchased_quantity: 1, unit_price_jpy: 8000 });
    const { updates } = readSheetRows(9, [row()], [already], resolve);
    expect(updates).toEqual([]);
  });

  it("matches on the line id, never the card", () => {
    // The same card twice at different prices is normal on a real list.
    const a = line({ plan_line_id: 1, unit_price_orig: 8000 });
    const b = line({ plan_line_id: 2, unit_price_orig: 15000 });
    const { updates } = readSheetRows(
      9, [row({ id: "plan:9#2", unit_paid: 15000 })], [a, b], resolve);
    expect(updates).toEqual([{
      plan_line_id: 2, outcome: "purchased", purchased_quantity: 1,
      unit_price_jpy: 15000, note: null,
    }]);
  });

  it("refuses a sheet downloaded from a different list", () => {
    const { updates, problems } = readSheetRows(9, [row({ id: "plan:4#1" })], [line()], resolve);
    expect(updates).toEqual([]);
    expect(problems[0].reason).toMatch(/different purchase list/);
  });

  it("refuses a purchase with no quantity or no price, the way the database does", () => {
    const r = readSheetRows(9, [row({ qty: "", unit_paid: "" })], [line()], resolve);
    expect(r.updates).toEqual([]);
    expect(r.problems[0].reason).toMatch(/quantity and a unit price/);
  });

  it("names the row when he typed something that is not an outcome", () => {
    const r = readSheetRows(9, [row({ outcome: "たぶん買った" })], [line()], resolve);
    expect(r.problems).toEqual([{ row: 2, reason: '"たぶん買った" is not one of the outcomes' }]);
  });

  it("catches a line pasted in twice rather than writing it twice", () => {
    const r = readSheetRows(9, [row(), row()], [line()], resolve);
    expect(r.updates.length).toBe(1);
    expect(r.problems[0].reason).toMatch(/appears twice/);
  });

  it("reports a row whose line has since left the list", () => {
    const r = readSheetRows(9, [row({ id: "plan:9#99" })], [line()], resolve);
    expect(r.problems[0].reason).toMatch(/not on this list any more/);
  });

  it("keeps going after a bad row instead of abandoning the file", () => {
    const r = readSheetRows(
      9,
      [row({ id: "junk" }), row({ id: "plan:9#2", unit_paid: 15000 })],
      [line(), line({ plan_line_id: 2 })],
      resolve,
    );
    expect(r.problems.length).toBe(1);
    expect(r.updates.length).toBe(1);
  });

  it("clears a purchase back to an unbought outcome", () => {
    const already = line({ outcome: "purchased", purchased_quantity: 1, unit_price_jpy: 8000 });
    const { updates } = readSheetRows(
      9, [row({ outcome: "売り切れ", qty: "", unit_paid: "" })], [already], resolve);
    expect(updates[0]).toMatchObject({ outcome: "sold_out", purchased_quantity: 0, unit_price_jpy: null });
  });
});

describe("sheetNumber", () => {
  it("reads what a person types into a spreadsheet cell", () => {
    expect(sheetNumber(8000)).toBe(8000);
    expect(sheetNumber("8,000")).toBe(8000);
    expect(sheetNumber("¥8,000")).toBe(8000);
    expect(sheetNumber(" 8000 ")).toBe(8000);
  });
  it("returns null rather than a NaN that would land as a lost value", () => {
    for (const v of [null, undefined, "", "-", "abc", 0, -5, "."]) {
      expect(sheetNumber(v), String(v)).toBeNull();
    }
  });
});
