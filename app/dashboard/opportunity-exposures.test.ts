import { describe, expect, it } from "vitest";
import { browserOpportunityPayloads, detailOpportunityPayloads } from "./opportunity-exposures";

const card = {
  key: "42:10",
  card: { card_id: "42", regional_name: "Test", set_code: "M6", card_number: "1", misc_info: null, image_url: null },
  psaGrade: 10,
  prices: {
    lowestSell: { price: 100, symbol: "$", currencyCode: "USD", normalizedPrice: 100, locationName: "tcgplayer", marketRegion: "NA" },
    highestBuy: null,
  },
  roi: 12,
  signal: null,
};

describe("opportunity exposure payloads", () => {
  it("records a displayed purchasable browser result and excludes indicators", () => {
    const payloads = browserOpportunityPayloads([card], "browser_list", "2026-07-21");
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual(expect.objectContaining({
      card_id: 42,
      psa_grade: 10,
      source_name: "tcgplayer",
      entry_price: 100,
      entry_currency: "USD",
    }));

    const indicator = {
      ...card,
      prices: { ...card.prices, lowestSell: { ...card.prices.lowestSell, locationName: "Collectr" } },
    };
    expect(browserOpportunityPayloads([indicator], "browser_grid", "2026-07-21")).toEqual([]);
  });

  it("records only buyable Sell rows from card detail", () => {
    const baseListing = {
      card_id: 42,
      price_type: "Sell" as const,
      price: 12000,
      currency: "JPY",
      currency_symbol: "¥",
      psa_grade: 10,
      condition: null,
      location_id: 5,
      listing_url: "https://shop.example/card/42",
      last_updated: "2026-07-21T00:00:00Z",
    };
    const payloads = detailOpportunityPayloads(
      card,
      [baseListing, { ...baseListing, price_type: "Buy" }],
      new Map([[5, { name: "cardrush", marketRegion: "JP" }]]),
    );

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual(expect.objectContaining({
      surface: "card_detail",
      source_location_id: 5,
      source_name: "cardrush",
      entry_price: 12000,
    }));
  });
});
