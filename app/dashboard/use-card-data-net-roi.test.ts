import { describe, expect, it } from "vitest";
import { summaryRowToCardRow, type SummaryRow } from "./use-card-data";

// A row's roi is the NET return (after the exit's selling costs) because every
// sort, filter and colour in the browser reads it; the gross figure rides
// along for display. Jirachi GX: bought $70.52 against ~$90 showed +28% gross
// and returned +1.6%.
describe("summaryRowToCardRow ROI", () => {
  const base = {
    card_id: 800239, tier: 1, psa_grade: 0,
    best_buy_price: 90.13, best_buy_currency: "USD", best_buy_symbol: "$", best_buy_location: "tcgplayer",
    best_buy_region: "NA", best_buy_normalized: 90.13, best_buy_kind: "sold",
    best_sell_price: 11145, best_sell_currency: "JPY", best_sell_symbol: "¥", best_sell_location: "cardrush",
    best_sell_region: "JP", best_sell_normalized: 70.52, best_sell_kind: "ask",
    roi: 27.8, net_roi: 1.3,
    best_opportunity_grade: null, deal_net_usd: null, deal_annualized: null,
    raw_to_grade_ev_usd: null, deal_relative_value_pct: null, deal_updated_at: null,
    pokemon_card_definitions: { card_id: 800239, regional_name: "ジラーチGX", set_code: "SM12A", card_number: "214/173" },
  } as unknown as SummaryRow;

  it("reports the net return as roi and keeps gross beside it", () => {
    const row = summaryRowToCardRow(base, "pokemon_card_definitions");
    expect(row.roi).toBe(1.3);
    expect(row.grossRoi).toBe(27.8);
  });

  it("shows no ROI rather than the gross one while net is not yet computed", () => {
    const row = summaryRowToCardRow({ ...base, net_roi: null } as SummaryRow, "pokemon_card_definitions");
    expect(row.roi).toBeNull();
    expect(row.grossRoi).toBe(27.8);
  });
});
