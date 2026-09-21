import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  table: "",
  select: "",
  currency: "",
  result: { data: null as unknown, error: null as unknown },
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      mocks.table = table;
      return {
        select: (select: string) => {
          mocks.select = select;
          return {
            eq: (_column: string, currency: string) => {
              mocks.currency = currency;
              return { maybeSingle: () => Promise.resolve(mocks.result) };
            },
          };
        },
      };
    },
  }),
}));

import {
  loadCurrentPurchaseFeePolicy,
  normalizePurchaseFeePolicy,
} from "./purchase-fee-policy";

beforeEach(() => {
  mocks.table = "";
  mocks.select = "";
  mocks.currency = "";
  mocks.result = { data: null, error: null };
});

const row = {
  policy_key: "jpy-buyer-fees-v2",
  currency: "JPY",
  effective_from: "2027-01-01",
  handling_rate: "0.045",
  line_fee_jpy: "125",
};

describe("effective purchase fee policy", () => {
  it("selects every authoritative term and normalizes PostgreSQL numerics", async () => {
    mocks.result = { data: row, error: null };

    await expect(loadCurrentPurchaseFeePolicy()).resolves.toEqual({
      policyKey: "jpy-buyer-fees-v2",
      currency: "JPY",
      effectiveFrom: "2027-01-01",
      handlingRate: 0.045,
      lineFeeJpy: 125,
    });
    expect(mocks.table).toBe("purchase_fee_policy_current_v");
    expect(mocks.currency).toBe("JPY");
    for (const field of [
      "policy_key",
      "currency",
      "effective_from",
      "handling_rate",
      "line_fee_jpy",
    ]) expect(mocks.select.split(",")).toContain(field);
  });

  it("fails the estimate closed when migration 460 is unavailable", async () => {
    mocks.result = {
      data: null,
      error: { code: "42P01", message: "relation does not exist" },
    };
    await expect(loadCurrentPurchaseFeePolicy()).resolves.toBeNull();
  });

  it("rejects malformed or unsupported policy rows", () => {
    expect(normalizePurchaseFeePolicy({ ...row, currency: "USD" })).toBeNull();
    expect(normalizePurchaseFeePolicy({ ...row, handling_rate: "NaN" })).toBeNull();
    expect(normalizePurchaseFeePolicy({ ...row, line_fee_jpy: "1.5" })).toBeNull();
    for (const value of [null, "", "  ", true, false]) {
      expect(normalizePurchaseFeePolicy({ ...row, handling_rate: value })).toBeNull();
      expect(normalizePurchaseFeePolicy({ ...row, line_fee_jpy: value })).toBeNull();
    }
    expect(normalizePurchaseFeePolicy({ ...row, effective_from: "2026-99-99" })).toBeNull();
    expect(normalizePurchaseFeePolicy({ ...row, effective_from: "2026-02-29" })).toBeNull();
    expect(normalizePurchaseFeePolicy({ ...row, effective_from: "2028-02-29" })).not.toBeNull();
  });
});
