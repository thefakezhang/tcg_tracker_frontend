// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key, language: "en" }),
}));
vi.mock("./CurrencyContext", () => ({
  useCurrency: () => ({ displayCurrency: "none", convertPrice: (p: number) => ({ price: p, symbol: "¥" }) }),
}));

import { ListingTable, type DetailListing } from "./CardDetailModal";

afterEach(cleanup);

// The count is the whole reason a multi-copy buy can be planned honestly, so the
// operator has to see it where they inspect a card's sources.
function listing(overrides: Partial<DetailListing> = {}): DetailListing {
  return {
    price: 500,
    currencySymbol: "¥",
    currencyCode: "JPY",
    locationName: "shinsoku",
    marketRegion: null,
    conditionLabel: "NM",
    listingUrl: null,
    lastUpdated: "2026-09-01T00:00:00Z",
    kind: null,
    ...overrides,
  } as DetailListing;
}

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

describe("ListingTable source depth", () => {
  it("shows how many copies the shop reported", () => {
    render(<ListingTable listings={[listing({ availableQuantity: 3 })]} conditionHeader="Cond" t={t as never} />);

    expect(screen.getByText(/cardDetail.copiesOnHand.*"count":3/)).toBeTruthy();
  });

  // null is "does not publish a count", not "has none". A 0 or a dash would
  // read as sold out for a listing that is on sale.
  it("shows nothing when the shop publishes no count", () => {
    render(<ListingTable listings={[listing({ availableQuantity: null })]} conditionHeader="Cond" t={t as never} />);

    expect(screen.queryByText(/copiesOnHand/)).toBeNull();
    expect(screen.getByText("shinsoku")).toBeTruthy();
  });

  it("shows nothing when the fetch did not select the column", () => {
    render(<ListingTable listings={[listing()]} conditionHeader="Cond" t={t as never} />);

    expect(screen.queryByText(/copiesOnHand/)).toBeNull();
  });
});
