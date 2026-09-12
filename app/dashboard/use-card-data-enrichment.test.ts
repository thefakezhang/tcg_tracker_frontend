import { describe, expect, it } from "vitest";
import {
  applyCardBrowserEnrichment,
  normalizeCardBrowserEnrichment,
  sortCardBrowserEnrichment,
  type CardRowData,
} from "./use-card-data";

function cardRow(id: number, grade = 10): CardRowData {
  return {
    key: `${id}:${grade}`,
    card: {
      card_id: String(id),
      regional_name: `Card ${id}`,
      set_code: "SV3",
      card_number: `${id}/100`,
      misc_info: null,
      image_url: null,
    },
    psaGrade: grade,
    prices: {
      highestBuy: null,
      lowestSell: {
        price: 20,
        symbol: "$",
        currencyCode: "USD",
        normalizedPrice: 20,
        locationName: "shop",
        marketRegion: "NA",
      },
    },
    roi: 1,
    enrichmentStatus: "loading",
  };
}

function signal(cardId: number, modelVersion: string, bandP25: number) {
  return {
    card_id: cardId,
    psa_grade: 10,
    model_version: modelVersion,
    computed_at: "2026-09-11T12:00:00Z",
    tier: "tier_1",
    best_jp_bid_jpy: 7000,
    best_jp_bid_location: 8,
    best_jp_bid_age_days: 1,
    band_p10: bandP25 - 100,
    band_p25: bandP25,
    band_p50: bandP25 + 100,
    band_p75: bandP25 + 200,
    last_sale_jpy: bandP25,
    last_sale_at: "2026-09-10T12:00:00Z",
    trend_slope: 0,
    trend_direction: "flat",
    comp_count_recent: 4,
    comp_count_lifetime: 8,
    listing_count: 2,
    sell_through: 0.5,
    clearing_vs_ask: 0.9,
    days_to_exit_est: 20,
    cohort: "set:SV3",
    pop: 10,
    pop_velocity: 1,
    entry_at_default: 20,
    net_at_default: 10,
    annualized_at_default: 0.2,
    exit_platform: "ebay",
    raw_to_grade_ev_usd: null,
    relative_value_pct: 0.1,
    recent_volatility: 0.05,
    slab_confidence: "high",
    flags: {},
  };
}

function response(signals: Record<string, unknown>[]) {
  return {
    signals,
    exit_cost_profile: {
      platform: "ebay",
      fee_pct: 0.13,
      fixed_fee: 0.4,
      shipping_jpy: 1400,
      grading_cost_jpy: 3500,
      grading_days: 45,
      margin_pct: 0.15,
      floor_usd: 0,
      updated_at: "2026-09-11T12:00:00Z",
    },
    exchange_rate: {
      rate: 0.0068,
      last_updated: "2026-09-11T12:00:00Z",
    },
    changepoints: [{
      cohort: "set:SV3",
      detected_on: "2026-09-10",
      direction: "up",
      magnitude: 0.12,
      event_title: "Release",
      unexplained: false,
    }],
  };
}

describe("Card Browser bounded enrichment", () => {
  it("attaches the latest deterministic model and page-cohort economics without changing row identity", () => {
    const original = [cardRow(7), cardRow(8)];
    const rows = applyCardBrowserEnrichment(original, response([
      signal(7, "v1", 9000),
      signal(7, "v2", 10000),
      signal(8, "v2", 8000),
    ]), 25);

    expect(rows.map((row) => row.key)).toEqual(original.map((row) => row.key));
    expect(rows[0]).toEqual(expect.objectContaining({
      enrichmentStatus: "ready",
      jpyUsd: 0.0068,
      fxAsOf: "2026-09-11T12:00:00Z",
    }));
    expect(rows[0].signal?.modelVersion).toBe("v2");
    expect(rows[0].signal?.bandP25).toBe(10000);
    expect(rows[0].changepoint).toEqual(expect.objectContaining({
      detectedOn: "2026-09-10",
      direction: "up",
    }));
  });

  it("sorts only enrichment-dependent client projections and leaves server order otherwise intact", () => {
    const enriched = applyCardBrowserEnrichment(
      [cardRow(7), cardRow(8)],
      response([signal(7, "v2", 8000), signal(8, "v2", 10000)]),
      25,
    );

    expect(sortCardBrowserEnrichment(enriched, "conservativeExit", false, 25).map((row) => row.key))
      .toEqual(["8:10", "7:10"]);
    expect(sortCardBrowserEnrichment(enriched, "roi", false, 25)).toBe(enriched);
  });

  it.each([
    null,
    {},
    { ...response([]), signals: null },
    { ...response([]), exchange_rate: { rate: 0, last_updated: "2026-09-11T12:00:00Z" } },
    { ...response([]), exchange_rate: { rate: "", last_updated: "2026-09-11T12:00:00Z" } },
    { ...response([]), exchange_rate: { rate: true, last_updated: "2026-09-11T12:00:00Z" } },
    { ...response([]), exit_cost_profile: { ...response([]).exit_cost_profile, platform: "other" } },
    { ...response([]), changepoints: [{ cohort: "set:SV3" }] },
    { ...response([]), changepoints: [{ ...response([]).changepoints[0], detected_on: "2026-02-30" }] },
    { ...response([]), signals: [{ ...signal(7, "v2", 10000), card_id: null }] },
    { ...response([]), signals: [{ ...signal(7, "v2", 10000), card_id: 7.5 }] },
    { ...response([]), signals: [{ ...signal(7, "v2", 10000), psa_grade: 9.5 }] },
    { ...response([]), signals: [{ ...signal(7, "v2", 10000), computed_at: "2026-02-30T12:00:00Z" }] },
  ])("fails closed on malformed RPC payload %#", (payload) => {
    expect(() => normalizeCardBrowserEnrichment(payload)).toThrow(
      "Card Browser enrichment returned an invalid response",
    );
  });

  it("accepts absent optional economics inputs without fabricating zero values", () => {
    const payload = { ...response([signal(7, "v2", 10000)]), exit_cost_profile: null, exchange_rate: null };
    const [row] = applyCardBrowserEnrichment([cardRow(7)], payload, 25);

    expect(row.enrichmentStatus).toBe("ready");
    expect(row.exitCostProfile).toBeNull();
    expect(row.jpyUsd).toBeNull();
    expect(row.deal).toBeNull();
  });
});
