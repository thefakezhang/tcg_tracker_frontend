// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "./LanguageContext";
import { ExitBasisProvider } from "./ExitBasisContext";
import GradeEvidencePanel from "./GradeEvidencePanel";
import { selectAll } from "@/lib/supabase/select-all";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
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

describe("GradeEvidencePanel", () => {
  beforeEach(() => {
    localStorage.clear();
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
          <GradeEvidencePanel cardId={42} setCode="M6" listingFreshnessLabel="Listing freshness lives below" />
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
});
