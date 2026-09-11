import { describe, it, expect } from "vitest";
import { landedPerCardJpy, type PurchaseFeePolicy } from "./purchase-fee-policy";

const policy: PurchaseFeePolicy = {
  policyKey: "jpy-buyer-fees-v1",
  currency: "JPY",
  effectiveFrom: "2026-09-11",
  handlingRate: 0.03,
  lineFeeJpy: 100,
};

// The buyer fees are 3% of card value plus a flat 100 JPY per purchased line,
// where a line is one listing. The flat part is what makes cheapest-sticker
// and cheapest-landed different answers, so the picker has to show landed.
describe("landedPerCardJpy", () => {
  it("adds 3% and one flat line fee, whatever the quantity", () => {
    // 1000 * 1.03 + 100 = 1130 for a single copy.
    expect(Math.round(landedPerCardJpy(1000, 1, policy))).toBe(1130);
  });

  it("amortises the flat fee across copies on ONE listing", () => {
    // Ten copies pay the 100 JPY once: (1000*10*1.03 + 100)/10 = 1040.
    expect(Math.round(landedPerCardJpy(1000, 10, policy))).toBe(1040);
  });

  it("shows why cheap singles are the expensive case", () => {
    // A 200 JPY card bought alone lands at 306 - a 53% premium - which is the
    // thing the operator must see BEFORE ordering, not at reconciliation.
    expect(Math.round(landedPerCardJpy(200, 1, policy))).toBe(306);
    // The same card bought twenty at a time lands at 211.
    expect(Math.round(landedPerCardJpy(200, 20, policy))).toBe(211);
  });

  it("never divides by zero", () => {
    expect(landedPerCardJpy(1000, 0, policy)).toBe(0);
  });

  it("uses the supplied effective policy and rounds handling half-up", () => {
    expect(landedPerCardJpy(50, 1, policy)).toBe(152);
    expect(landedPerCardJpy(1000, 1, {
      ...policy,
      handlingRate: 0.05,
      lineFeeJpy: 250,
    })).toBe(1300);
  });
});
