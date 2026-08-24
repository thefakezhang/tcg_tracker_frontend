// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ShoppingListView from "./ShoppingListView";

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./use-query", () => ({
  QueryError: () => null,
  useSupabaseQuery: () => ({
    data: [{
      game: "pokemon",
      card_id: 1,
      product_id: null,
      item_name: "マスターのカギ",
      english_name: "Master's Key",
      set_code: "L-P",
      card_number: "068/L-P",
      misc_info: null,
      rarity: "Promo",
      is_japan_exclusive: true,
      japan_exclusive_artwork: true,
      japan_exclusive_artwork_reason: "Artwork evidence.",
      japan_exclusive_artwork_evidence_url: "https://example.com/artwork",
      japan_exclusive_stamps: true,
      japan_exclusive_stamps_reason: "Stamp evidence.",
      japan_exclusive_stamps_evidence_url: "https://example.net/stamp",
      japan_exclusivity_modes: ["both", "legacy"],
      release_date: "2010-01-01",
      interested_customers: 2,
      top_priority: 1,
      top_ceiling_usd: 5000,
      customer_ids: [1, 2],
    }],
    error: null,
    isLoading: false,
    retry: vi.fn(),
  }),
}));

describe("ShoppingListView Japanese exclusivity evidence", () => {
  it("keeps legacy separate and renders independent artwork and stamp links", () => {
    render(<ShoppingListView />);

    expect(screen.getByText("customers.japanExclusivity.legacy")).toBeTruthy();
    expect(screen.getByTestId("japan-exclusive-artwork").getAttribute("href")).toBe("https://example.com/artwork");
    expect(screen.getByTestId("japan-exclusive-stamps").getAttribute("href")).toBe("https://example.net/stamp");
    expect(screen.getByText(/shoppingList\.criteriaModes/).textContent).toContain("customers.japanExclusivity.both");
  });
});
