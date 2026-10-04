// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingPurchaseReconciliation,
  createPendingPurchaseReconciliation,
  readPendingPurchaseReconciliation,
  writePendingPurchaseReconciliation,
  type PurchaseReconciliationPayload,
} from "./purchase-reconciliation-pending";

const payload: PurchaseReconciliationPayload = {
  p_plan_id: 9,
  p_trip_id: 4,
  p_fx_rate: 150,
  p_shipping_jpy: { cardrush: 900 },
  p_float_funding_jpy: {
    cardrush: {
      card_jpy: 10000,
      buyer_handling_jpy: 400,
      shipping_jpy: 900,
      payment_fee_jpy: 0,
      customs_jpy: 0,
      other_jpy: 0,
    },
  },
};

beforeEach(() => window.localStorage.clear());

describe("purchase reconciliation pending request", () => {
  it("persists one immutable nested payload per operator", () => {
    const request = createPendingPurchaseReconciliation(
      "operator-1", payload, "11111111-1111-4111-8111-111111111111",
    );
    writePendingPurchaseReconciliation(request);

    expect(readPendingPurchaseReconciliation("operator-1")).toEqual(request);
    expect(readPendingPurchaseReconciliation("operator-2")).toBeNull();
    clearPendingPurchaseReconciliation("operator-1");
    expect(readPendingPurchaseReconciliation("operator-1")).toBeNull();
  });

  it.each([
    ["missing component", { ...payload, p_float_funding_jpy: { cardrush: { card_jpy: 1 } } }],
    ["unknown component", {
      ...payload,
      p_float_funding_jpy: {
        cardrush: { ...payload.p_float_funding_jpy.cardrush, rebate_jpy: 1 },
      },
    }],
    ["negative component", {
      ...payload,
      p_float_funding_jpy: {
        cardrush: { ...payload.p_float_funding_jpy.cardrush, shipping_jpy: -1 },
      },
    }],
    ["ambiguous source", {
      ...payload,
      p_shipping_jpy: { " CardRush ": 900 },
    }],
    ["nonpositive rate", { ...payload, p_fx_rate: 0 }],
  ])("fails closed on %s", (_label, malformed) => {
    window.localStorage.setItem(
      "tcg:purchase-reconciliation-pending:v1:operator-1",
      JSON.stringify({
        version: 1,
        ownerId: "operator-1",
        requestId: "22222222-2222-4222-8222-222222222222",
        createdAt: "2026-10-04T00:00:00.000Z",
        payload: malformed,
      }),
    );

    expect(() => readPendingPurchaseReconciliation("operator-1"))
      .toThrow("Invalid persisted purchase reconciliation request");
  });
});
