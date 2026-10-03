import { describe, expect, it } from "vitest";
import {
  assertFloatProjection,
  assertSingleReplay,
  expectedFloatProjection,
} from "./financial-integrity-browser-helpers.mjs";

describe("financial-integrity browser evidence helpers", () => {
  it("pins the remittance, purchase, refund, settlement, and balance projection", () => {
    expect(expectedFloatProjection()).toEqual({
      remitted_jpy: 14_000,
      spent_jpy: 2_000,
      fees_jpy: 160,
      refunded_jpy: 500,
      settled_jpy: 1_000,
      balance_jpy: 11_340,
    });
    expect(() => assertFloatProjection(expectedFloatProjection())).not.toThrow();
    expect(() => assertFloatProjection({
      ...expectedFloatProjection(),
      balance_jpy: 12_340,
    })).toThrow(/balance_jpy/);
  });

  it("requires exactly one durable movement and one journal reference after replay", () => {
    expect(assertSingleReplay([{
      request_id: "00000000-0000-4000-8000-000000000001",
      gl_entry_id: 91,
    }], "00000000-0000-4000-8000-000000000001")).toBe(91);
    expect(() => assertSingleReplay([], "lost-response-request")).toThrow(/wrote 0/);
    expect(() => assertSingleReplay([
      { request_id: "duplicate", gl_entry_id: 1 },
      { request_id: "duplicate", gl_entry_id: 2 },
    ], "duplicate")).toThrow(/wrote 2/);
  });
});
