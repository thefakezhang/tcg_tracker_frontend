import { describe, expect, it } from "vitest";
import { formatJpy, formatRoi, formatUsd, formatUsdCompact, formatUsdWhole } from "./money";

// The app once had four USD formats, three JPY copies and six inline ROI
// formulas. These pin the shared ones so a "fix" in one place cannot drift.
describe("money formatters", () => {
  it("formatUsd is two-decimal with thousands separators", () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(890.625)).toBe("$890.63");
    expect(formatUsd(0)).toBe("$0.00");
  });
  it("puts the sign before the symbol on negatives and never prints -$0.00", () => {
    expect(formatUsd(-1234.567)).toBe("-$1,234.57");
    expect(formatUsd(-0.001)).toBe("$0.00");
    expect(formatUsdWhole(-1234.5)).toBe("-$1,235");
    expect(formatUsdWhole(-0.4)).toBe("$0");
  });
  it("formatUsdWhole rounds to dollars", () => {
    expect(formatUsdWhole(1234.5)).toBe("$1,235");
    expect(formatUsdWhole(0.4)).toBe("$0");
  });
  it("formatUsdCompact keeps cents only under $100", () => {
    expect(formatUsdCompact(99.999)).toBe("$100.00");
    expect(formatUsdCompact(100)).toBe("$100");
    expect(formatUsdCompact(12345.67)).toBe("$12,346");
    expect(formatUsdCompact(0.09)).toBe("$0.09");
  });
  it("formatJpy never shows fractions", () => {
    expect(formatJpy(3299.6)).toBe("¥3,300");
  });
  it("formatRoi trims to two decimals and dashes unknowns", () => {
    expect(formatRoi(12.5)).toBe("12.5%");
    expect(formatRoi(1234.5678)).toBe("1234.57%");
    expect(formatRoi(0)).toBe("0%");
    expect(formatRoi(null)).toBe("—");
    expect(formatRoi(Number.NaN)).toBe("—");
  });
});
