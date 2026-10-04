// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingBuyerFloatRequest,
  createPendingBuyerFloatRequest,
  isBuyerFloatOutcomeUnknown,
  readPendingBuyerFloatRequest,
  requireBuyerFloatVerification,
  writePendingBuyerFloatRequest,
} from "./buyer-float-pending";

beforeEach(() => window.localStorage.clear());

describe("buyer-float pending requests", () => {
  it("persists an immutable request under the authenticated owner and operation", () => {
    const request = createPendingBuyerFloatRequest("operator-1", "refund", {
      p_plan_line_id: 17,
      p_amount_jpy: 4200,
      p_occurred_at: "2026-10-03",
      p_note: "cancelled",
    }, "request-17");

    writePendingBuyerFloatRequest(request);

    expect(readPendingBuyerFloatRequest("operator-1", "refund")).toEqual(request);
    expect(readPendingBuyerFloatRequest("operator-2", "refund")).toBeNull();
    expect(readPendingBuyerFloatRequest("operator-1", "settlement")).toBeNull();
  });

  it("persists the verify-only fence before a non-idempotent compatibility call", () => {
    const request = createPendingBuyerFloatRequest("operator-1", "settlement", {
      p_buyer_email: "agent@example.com",
      p_cash_account: "1000",
      p_amount_usd: 6.25,
      p_amount_jpy: 900,
      p_occurred_at: "2026-10-03",
      p_trip_id: null,
      p_note: null,
    }, "request-18");

    writePendingBuyerFloatRequest(requireBuyerFloatVerification(request));

    expect(readPendingBuyerFloatRequest("operator-1", "settlement")?.retryPolicy).toBe("verify");
    clearPendingBuyerFloatRequest("operator-1", "settlement");
    expect(readPendingBuyerFloatRequest("operator-1", "settlement")).toBeNull();
  });

  it("fails closed on malformed persisted state", () => {
    window.localStorage.setItem(
      "tcg:buyer-float-pending:v1:operator-1:remittance",
      JSON.stringify({ version: 1, ownerId: "operator-1", operation: "remittance" }),
    );

    expect(() => readPendingBuyerFloatRequest("operator-1", "remittance"))
      .toThrow("Invalid persisted remittance request");
  });

  it("rejects a legacy settlement payload without destination cash evidence", () => {
    window.localStorage.setItem(
      "tcg:buyer-float-pending:v1:operator-1:settlement",
      JSON.stringify({
        version: 1,
        ownerId: "operator-1",
        operation: "settlement",
        requestId: "legacy-settlement",
        createdAt: "2026-10-03T00:00:00.000Z",
        retryPolicy: "safe",
        payload: {
          p_buyer_email: "agent@example.com",
          p_amount_jpy: 900,
          p_occurred_at: "2026-10-03",
          p_trip_id: null,
          p_note: null,
        },
      }),
    );

    expect(() => readPendingBuyerFloatRequest("operator-1", "settlement"))
      .toThrow("Invalid persisted settlement request");
  });

  it("separates ambiguous transport outcomes from definite database rejection", () => {
    expect(isBuyerFloatOutcomeUnknown({ code: "57014" })).toBe(true);
    expect(isBuyerFloatOutcomeUnknown({ code: "08006" })).toBe(true);
    expect(isBuyerFloatOutcomeUnknown({ status: 503 })).toBe(true);
    expect(isBuyerFloatOutcomeUnknown(new Error("connection closed"))).toBe(true);
    expect(isBuyerFloatOutcomeUnknown({ code: "P0001" })).toBe(false);
  });
});
