import { describe, expect, it } from "vitest";
import { parseSaleQuantity } from "./sale-input";

describe("parseSaleQuantity", () => {
  it("requires an explicit whole-copy count within on-hand inventory", () => {
    expect(parseSaleQuantity("", 5)).toBeNull();
    expect(parseSaleQuantity("0", 5)).toBeNull();
    expect(parseSaleQuantity("1.5", 5)).toBeNull();
    expect(parseSaleQuantity("6", 5)).toBeNull();
    expect(parseSaleQuantity(" 3 ", 5)).toBe(3);
  });
});
