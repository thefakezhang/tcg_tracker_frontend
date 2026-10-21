import { describe, expect, it } from "vitest";

import {
  observationCursor,
  parseUnresolvedBuylistObservationRows,
} from "./unresolved-buylist-observations";

function row(overrides: Record<string, unknown> = {}) {
  return {
    routing_outcome_id: 9,
    observation_ordinal: 2,
    routed_at: "2026-10-20T14:00:00Z",
    tweet_id: "tweet-9",
    buyer_handle: "shop",
    twitter_handle: "shop_cards",
    tweet_url: "https://x.example/shop/status/tweet-9",
    source_image_index: 0,
    source_image_url: "https://images.example/sheet.jpg",
    source_content_sha256: "a".repeat(64),
    policy_version: "fixture:outcome-v2",
    observation: {
      schema_version: 1,
      source_image_index: 0,
      source_cell_index: 21,
      source_image_width: 300,
      source_image_height: 200,
      product_kind: "singles",
      identity: { status: "unresolved", reason: "matcher_abstained", catalog_id: null },
      grade: { status: "not_observed", value: null },
      variant: null,
      price_side: "bid",
      source_geometry: {
        card: { x0: 90, y0: 0, x1: 170, y1: 120 },
        price: { x0: 90, y0: 120, x1: 170, y1: 140 },
      },
      effective_geometry: {
        card: { x0: 91, y0: 0, x1: 171, y1: 120 },
        price: { x0: 91, y0: 120, x1: 171, y1: 140 },
      },
      detector_context: { processor: "fixture" },
      prices: [
        {
          amount_jpy: 110000,
          tier: "item",
          source_bbox: { x0: 90, y0: 120, x1: 170, y1: 140 },
          effective_bbox: { x0: 91, y0: 120, x1: 171, y1: 140 },
          evidence: {
            verified: true,
            method: "currency_marker",
            ocr_confidence: 0.94,
          },
        },
        {
          amount_jpy: 74000,
          tier: "cash",
          source_bbox: { x0: 90, y0: 145, x1: 170, y1: 165 },
          effective_bbox: { x0: 91, y0: 145, x1: 171, y1: 165 },
          evidence: {
            verified: true,
            method: "grouped_number",
            ocr_confidence: 0.91,
          },
        },
      ],
      financial_eligibility: "ineligible_unresolved_identity",
    },
    ...overrides,
  };
}

describe("unresolved buylist observation read contract", () => {
  it("preserves every verified tier, geometry pair, grade absence and cursor", () => {
    const parsed = parseUnresolvedBuylistObservationRows([row()]);

    expect(parsed[0].prices.map((price) => price.amountJpy)).toEqual([110000, 74000]);
    expect(parsed[0].prices[1].tier).toBe("cash");
    expect(parsed[0].sourceGeometry.card).toEqual({ x0: 90, y0: 0, x1: 170, y1: 120 });
    expect(parsed[0].effectiveGeometry.card.x0).toBe(91);
    expect(parsed[0].grade).toEqual({ status: "not_observed", value: null });
    expect(observationCursor(parsed)).toEqual({ routingOutcomeId: 9, observationOrdinal: 2 });
  });

  it("fails closed on identity, financial, association and geometry drift", () => {
    const cases = [
      () => {
        const fixture = row();
        (fixture.observation.identity as Record<string, unknown>).catalog_id = 44;
        return fixture;
      },
      () => {
        const fixture = row();
        fixture.observation.financial_eligibility = "eligible";
        return fixture;
      },
      () => {
        const fixture = row();
        fixture.observation.prices[0].evidence.verified = false;
        return fixture;
      },
      () => {
        const fixture = row();
        fixture.observation.prices[0].effective_bbox.x1 = 301;
        return fixture;
      },
      () => ({ ...row(), source_content_sha256: null }),
      () => {
        const fixture = row();
        fixture.observation.prices[0].amount_jpy = 100_000_001;
        return fixture;
      },
      () => {
        const fixture = row();
        fixture.observation.product_kind = "sealed";
        return fixture;
      },
    ];
    for (const makeFixture of cases) {
      expect(() => parseUnresolvedBuylistObservationRows([makeFixture()])).toThrow(
        "Malformed unresolved buylist observation",
      );
    }
  });
});
