import { describe, expect, it } from "vitest";
import { parseTypedPrice } from "./PurchasePlannerView";

describe("parseTypedPrice", () => {
  it("accepts prices the way people actually type them", () => {
    // Every one of these was NaN under Number(), and NaN serialises to null -
    // so the line saved with no price at all and no error.
    expect(parseTypedPrice("8,000")).toBe(8000);
    expect(parseTypedPrice("¥8000")).toBe(8000);
    expect(parseTypedPrice("8000 JPY")).toBe(8000);
    expect(parseTypedPrice(" 11,200 ")).toBe(11200);
    expect(parseTypedPrice("$12.50")).toBe(12.5);
    expect(parseTypedPrice("8000")).toBe(8000);
  });

  it("refuses text with no number in it, rather than storing nothing", () => {
    for (const bad of ["", "   ", "abc", "¥", "-", "."]) {
      expect(parseTypedPrice(bad), `${JSON.stringify(bad)} should be refused`).toBeNull();
    }
  });

  it("refuses zero and negatives, which are not prices", () => {
    expect(parseTypedPrice("0")).toBeNull();
    expect(parseTypedPrice("-5")).toBeNull();
  });
});
