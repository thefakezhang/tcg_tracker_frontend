// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisionActions, decisionSnapshot } from "./DecisionActions";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

afterEach(() => {
  cleanup();
  mocks.rpc.mockReset();
});

describe("decisionSnapshot", () => {
  it("captures the exact signal and browser inputs without reducing them to a score", () => {
    const row = {
      key: "42:10",
      card: { card_id: "42", regional_name: "Test", set_code: "M6", card_number: "1", misc_info: null, image_url: null },
      psaGrade: 10,
      prices: {
        lowestSell: { price: 100, symbol: "$", currencyCode: "USD", normalizedPrice: 100, locationName: "shop", marketRegion: "NA" },
        highestBuy: null,
      },
      roi: 12,
    };
    const signal = {
      cardId: 42, psaGrade: 10, modelVersion: "s2-v2", computedAt: "2026-07-20T00:00:00Z",
      tier: "tier_2", bestJpBidJpy: 10, bestJpBidLocation: 5, bestJpBidAgeDays: 7,
      bandP10: 80, bandP25: 90, bandP50: 100, bandP75: 110, lastSaleJpy: 100, lastSaleAt: null,
      trendSlope: null, trendDirection: "flat", compCountRecent: 4, compCountLifetime: 8,
      listingCount: 2, sellThrough: 0.5, clearingVsAsk: 0.9, daysToExitEst: 20,
      cohort: "Test", pop: 10, popVelocity: 1, entryAtDefault: 70, netAtDefault: 10,
      annualizedAtDefault: 0.2, exitPlatform: "ebay", rawToGradeEvUsd: null,
      relativeValuePct: 0.1, flags: {},
    };
    const snapshot = decisionSnapshot(row, signal);
    expect(snapshot.signal).toEqual(signal);
    expect(snapshot.browser.lowest_buy?.normalizedPrice).toBe(100);
    expect(snapshot.browser.roi).toBe(12);
    expect(snapshot.no_signals_at_decision_time).toBe(false);
  });

  it("keeps Pass out of the primary workflow and requires a reason to dismiss", async () => {
    mocks.rpc.mockResolvedValue({ data: 1, error: null });
    const row = {
      key: "42:10",
      card: { card_id: "42", regional_name: "Test", set_code: "M6", card_number: "1", misc_info: null, image_url: null },
      psaGrade: 10,
      prices: { lowestSell: null, highestBuy: null },
      roi: null,
    };

    render(<DecisionActions row={row} />);

    expect(screen.queryByRole("button", { name: /pass/i })).toBeNull();
    expect(screen.getByRole("button", { name: "decision.watch" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "decision.dismissOpportunity" }));

    const dismiss = screen.getByRole("button", { name: "decision.dismiss" });
    expect((dismiss as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("decision.dismissReasonPlaceholder"), { target: { value: "margin too thin" } });
    fireEvent.click(dismiss);

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(
      "dismiss_deal_opportunity",
      expect.objectContaining({
        p_card_id: 42,
        p_psa_grade: 10,
        p_reason: "margin too thin",
      }),
    ));
  });
});
