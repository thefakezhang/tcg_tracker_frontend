import { describe, expect, it } from "vitest";
import { decisionSnapshot } from "./DecisionActions";

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
      cohort: "Test", pop: 10, popVelocity: 1, flags: {},
    };
    const snapshot = decisionSnapshot(row, signal);
    expect(snapshot.signal).toEqual(signal);
    expect(snapshot.browser.lowest_buy?.normalizedPrice).toBe(100);
    expect(snapshot.browser.roi).toBe(12);
    expect(snapshot.no_signals_at_decision_time).toBe(false);
  });
});
