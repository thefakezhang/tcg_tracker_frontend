// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "./LanguageContext";
import { ExitBasisProvider } from "./ExitBasisContext";
import GradeEvidencePanel from "./GradeEvidencePanel";
import { selectAll } from "@/lib/supabase/select-all";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const result = table === "exit_cost_profiles"
        ? { data: { platform: "ebay", fee_pct: 0.136, fixed_fee: 0.4, shipping_jpy: 1000, grading_cost_jpy: 3500, grading_days: 45, margin_pct: 0.15, floor_usd: 0, updated_at: "2026-07-20T00:00:00Z" } }
        : { data: { rate: 0.0065, last_updated: "2026-07-20T00:00:00Z" } };
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve(result),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/select-all", () => ({ selectAll: vi.fn() }));
vi.mock("./use-card-data", () => ({
  fetchLocationMap: vi.fn().mockResolvedValue(new Map([[5, { name: "cardrush", marketRegion: "JP" }]])),
}));

const signal = {
  card_id: 42,
  psa_grade: 10,
  model_version: "s2-v2",
  computed_at: "2026-07-20T22:54:47Z",
  tier: "tier_3_ask",
  best_jp_bid_jpy: 60_000,
  best_jp_bid_location: 5,
  best_jp_bid_age_days: 12,
  band_p10: 80_000,
  band_p25: 90_000,
  band_p50: 100_000,
  band_p75: 120_000,
  trend_direction: "rising",
  comp_count_recent: 2,
  comp_count_lifetime: 8,
  listing_count: 4,
  sell_through: 0.5,
  clearing_vs_ask: 0.92,
  pop: 20,
  pop_velocity: 1.5,
  flags: { thin_evidence: true, cohort_derived: true, cohort_own_weight: 0.4 },
};

afterEach(cleanup);

describe("GradeEvidencePanel", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.rpc.mockReset().mockResolvedValue({ data: 1, error: null });
    vi.mocked(selectAll)
      .mockReset()
      .mockResolvedValueOnce([signal])
      .mockResolvedValueOnce([
        { sale_id: 1, grade: 10, sale_date: "2026-06-01T00:00:00Z", price_usd: 600, platform: "eBay" },
        { sale_id: 2, grade: 10, sale_date: "2026-07-01T00:00:00Z", price_usd: 700, platform: "eBay" },
      ])
      .mockResolvedValueOnce([
        { event_id: 7, starts_on: "2026-06-15", ends_on: null, scope: "set", scope_ref: "M6", card_ids: null, title: "M6 release", kind: "set_release", confidence: "confirmed" },
      ]);
  });

  it("renders the grade basis, caveats, demand, bid age, and distinct freshness labels", async () => {
    render(
      <LanguageProvider>
        <ExitBasisProvider>
          <GradeEvidencePanel
            card={{
              key: "42:10",
              card: { card_id: "42", regional_name: "Test", set_code: "M6", card_number: "1", misc_info: null, image_url: null },
              psaGrade: 10,
              prices: { highestBuy: null, lowestSell: null },
              roi: null,
            }}
            cardId={42}
            setCode="M6"
            listingFreshnessLabel="Listing freshness lives below"
          />
        </ExitBasisProvider>
      </LanguageProvider>,
    );

    await waitFor(() => expect(screen.getByText("PSA 10")).toBeTruthy());
    expect(screen.getAllByText("¥90,000")).toHaveLength(2);
    expect(screen.getByText("Thin evidence")).toBeTruthy();
    expect(screen.getByText("Cohort-derived 40% own")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("12 days")).toBeTruthy();
    expect(screen.getByText("cardrush")).toBeTruthy();
    expect(screen.getByText(/Signal snapshot/)).toBeTruthy();
    expect(screen.getByText("Listing freshness lives below")).toBeTruthy();
    expect(screen.getByRole("img", { name: /sold comps with market event markers/i })).toBeTruthy();
  });

  it("records one store sighting from one always-visible price form when evidence is unavailable", async () => {
    vi.mocked(selectAll)
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    function Harness() {
      const [price, setPrice] = useState("");
      const [currency, setCurrency] = useState<"JPY" | "USD">("JPY");
      return (
        <LanguageProvider>
          <ExitBasisProvider>
            <GradeEvidencePanel
              card={{
                key: "42:raw",
                card: { card_id: "42", regional_name: "Test", set_code: "M6", card_number: "1", misc_info: null, image_url: null },
                psaGrade: undefined,
                prices: { highestBuy: null, lowestSell: null },
                roi: null,
              }}
              cardId={42}
              setCode="M6"
              listingFreshnessLabel="Listing freshness"
              askingPrice={price}
              askingCurrency={currency}
              onAskingPriceChange={setPrice}
              onAskingCurrencyChange={setCurrency}
            />
          </ExitBasisProvider>
        </LanguageProvider>
      );
    }

    render(<Harness />);

    await waitFor(() => expect(screen.getByText("No computed grade signals are available for this card yet.")).toBeTruthy());
    expect(screen.getAllByLabelText("Sticker / asking price")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Store"), { target: { value: "Card shop A" } });
    fireEvent.change(screen.getByLabelText("Sticker / asking price"), { target: { value: "12000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save store sighting" }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(
      "record_deal_store_sighting",
      expect.objectContaining({
        p_card_id: 42,
        p_psa_grade: 0,
        p_store_name: "Card shop A",
        p_observed_price: 12000,
        p_currency: "JPY",
      }),
    ));
  });
});
