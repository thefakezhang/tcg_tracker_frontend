import { describe, expect, it } from "vitest";
import {
  inventoryEconomicsTotals,
  type InventoryEconomicsRow,
} from "./inventory-economics";

function row(
  patch: Partial<InventoryEconomicsRow>,
): InventoryEconomicsRow {
  return {
    line_key: "pokemon:1",
    lot_line_id: 1,
    lot_id: 10,
    trip_id: 2,
    trip_name: "Tokyo",
    leg: "import",
    acquired_at: "2026-07-01",
    finalized_at: "2026-07-02",
    game: "pokemon",
    item_type: "single",
    card_id: 42,
    product_id: null,
    condition_id: 1,
    psa_grade: 0,
    sealed_condition: null,
    variant_edition: null,
    name: "Test",
    english_name: null,
    set_code: "TST",
    card_number: "001",
    image_url: null,
    quantity: 2,
    qty_remaining: 1,
    qty_sold: 1,
    lifecycle_status: "partial",
    direct_purchase_cost_usd: 10,
    acquisition_cost_alloc_usd: 2,
    landed_cost_usd: 12,
    on_hand_cost_usd: 6,
    gross_usd: 20,
    sale_expenses_usd: 3,
    net_proceeds_usd: 17,
    cogs_usd: 6,
    profit_usd: 11,
    allocation_snapshot: {},
    finalization_snapshot: null,
    sale_activity: [],
    ...patch,
  };
}

describe("inventory economics totals", () => {
  it("keeps direct, acquisition, landed, on-hand, and realized values distinct", () => {
    expect(inventoryEconomicsTotals([
      row({}),
      row({
        line_key: "pokemon:2",
        direct_purchase_cost_usd: 5,
        acquisition_cost_alloc_usd: -1,
        landed_cost_usd: 4,
        on_hand_cost_usd: 0,
        net_proceeds_usd: 8,
        profit_usd: 4,
      }),
    ])).toEqual({
      directPurchaseUsd: 15,
      acquisitionCostsUsd: 1,
      landedCostUsd: 16,
      onHandCostUsd: 6,
      netProceedsUsd: 25,
      realizedProfitUsd: 15,
    });
  });
});
