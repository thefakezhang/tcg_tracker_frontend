import { describe, expect, it } from "vitest";
import {
  candidateListingKey,
  candidatePlanLine,
  manualPlanLine,
  type CandidateListing,
  type CatalogResult,
} from "./PurchasePlannerView";

const chosen: CatalogResult = {
  id: 41,
  game: "pokemon_sealed",
  label: "Test Box",
  sealedCondition: "shrink",
  variantEdition: "1ed",
};

const candidate = (over: Partial<CandidateListing> = {}): CandidateListing => ({
  listing_id: 91,
  product_id: 41,
  sealed_condition: "shrink",
  variant_edition: "1ed",
  source: "cardrush",
  listing_url: "https://shop.test/box",
  asking_price: 1200,
  currency: "JPY",
  observed_at: "2026-09-11T10:00:00Z",
  stale: false,
  available_quantity: null,
  ...over,
});

describe("exact sealed purchase-plan lines", () => {
  it("keeps condition and edition on a crawled candidate", () => {
    expect(candidatePlanLine(7, chosen, "0", candidate(), 3)).toEqual({
      plan_id: 7,
      game: "pokemon_sealed",
      card_id: null,
      product_id: 41,
      psa_grade: null,
      sealed_condition: "shrink",
      variant_edition: "1ed",
      planned_quantity: 3,
      source: "cardrush",
      source_listing_url: "https://shop.test/box",
      unit_price_orig: 1200,
      currency: "JPY",
      source_observed_at: "2026-09-11T10:00:00Z",
    });
  });

  it("keeps manually chosen axes and normalizes the shop without changing identity", () => {
    expect(manualPlanLine(
      7,
      chosen,
      "0",
      "no_shrink",
      "unlimited",
      "2",
      " CardRush ",
      " https://shop.test/manual ",
      "¥1,450",
      "JPY",
      "2026-09-11T11:00:00Z",
    )).toMatchObject({
      product_id: 41,
      card_id: null,
      sealed_condition: "no_shrink",
      variant_edition: "unlimited",
      planned_quantity: 2,
      source: "cardrush",
      source_listing_url: "https://shop.test/manual",
      unit_price_orig: 1450,
    });
  });

  it("does not collapse one URL across exact sealed variants", () => {
    const shrink = candidate();
    const noShrink = candidate({
      listing_id: 92,
      sealed_condition: "no_shrink",
      variant_edition: "unlimited",
    });
    expect(candidateListingKey(shrink)).not.toBe(candidateListingKey(noShrink));
  });
});
