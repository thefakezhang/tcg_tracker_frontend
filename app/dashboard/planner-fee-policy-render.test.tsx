// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key} ${Object.values(params).join(" ")}` : key,
  }),
}));

import {
  CandidatePicker,
  type CandidateListing,
} from "./PurchasePlannerView";

afterEach(cleanup);

const candidate: CandidateListing = {
  source: "cardrush",
  listing_url: "https://shop.test/one",
  asking_price: 1000,
  currency: "JPY",
  observed_at: "2026-09-11T12:00:00Z",
  stale: false,
  available_quantity: 4,
};

const renderPicker = (state: Parameters<typeof CandidatePicker>[0]["feePolicy"]) => {
  const onToggle = vi.fn();
  render(
    <CandidatePicker
      candidates={[candidate]}
      feePolicy={state}
      picked={new Map()}
      onToggle={onToggle}
      onQuantity={vi.fn()}
    />,
  );
  return onToggle;
};

describe("purchase candidate fee policy", () => {
  it("shows the effective terms and derives the candidate estimate from them", () => {
    renderPicker({
      status: "ready",
      policy: {
        policyKey: "jpy-buyer-fees-v2",
        currency: "JPY",
        effectiveFrom: "2027-01-01",
        handlingRate: 0.05,
        lineFeeJpy: 250,
      },
    });
    expect(screen.getByRole("status").textContent).toContain("purchasePlanner.feePolicy 5 250 2027-01-01");
    expect(screen.getByText(/purchasePlanner\.perCardJpy 1,300/)).toBeTruthy();
  });

  it("keeps listing selection usable while the policy schema is unavailable", () => {
    const onToggle = renderPicker({ status: "unavailable", policy: null });
    expect(screen.getByRole("status").textContent).toBe("purchasePlanner.feePolicyUnavailable");
    expect(screen.getByText("purchasePlanner.feeEstimateUnavailableShort")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "select cardrush" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
