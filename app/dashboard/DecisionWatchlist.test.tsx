// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DecisionWatchlist from "./DecisionWatchlist";
import { selectAll } from "@/lib/supabase/select-all";

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ t: (key: string, params?: { count?: number; value?: string }) => params?.count ?? params?.value ?? key }),
}));
vi.mock("./LanguageContext", () => ({ useLanguage: () => ({ language: "en" }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: vi.fn() }) }));
vi.mock("@/lib/supabase/select-all", () => ({ selectAll: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DecisionWatchlist", () => {
  it("shows all store sightings with the normalized cheapest option first", async () => {
    vi.mocked(selectAll).mockResolvedValue([{
      rule_id: 1,
      card_id: 42,
      psa_grade: 10,
      decided_at: "2026-07-20T10:00:00Z",
      flagged_price: 1000,
      flagged_currency: "JPY",
      current_price: 1100,
      current_currency: "JPY",
      current_observed_on: "2026-07-20",
      reason: null,
      regional_name: "テスト",
      english_name: "Test Card",
      set_code: "M6",
      card_number: "001",
      image_url: null,
      store_sightings: [
        { sighting_id: 1, store_name: "Store A", observed_price: 1000, currency: "JPY", fx_rate_to_usd: 0.0065, price_usd: 6.5, observed_at: "2026-07-20T10:00:00Z", note: null },
        { sighting_id: 2, store_name: "Store B", observed_price: 8, currency: "USD", fx_rate_to_usd: 1, price_usd: 8, observed_at: "2026-07-20T11:00:00Z", note: "Second stop" },
      ],
    }]);

    render(<DecisionWatchlist />);

    await waitFor(() => expect(screen.getByText("Store A")).toBeTruthy());
    expect(screen.getByText("Store B")).toBeTruthy();
    expect(screen.getByText("decision.cheapest")).toBeTruthy();
    expect(screen.getByText("$6.50")).toBeTruthy();
  });
});
