export interface SaleActivity {
  sale_id: number;
  sale_group: number | null;
  sold_at: string;
  quantity: number;
  gross_usd: number;
  expenses_usd: number;
  cogs_usd: number;
  profit_usd: number;
}

export interface InventoryEconomicsRow {
  line_key: string;
  lot_line_id: number;
  lot_id: number;
  trip_id: number | null;
  trip_name: string | null;
  leg: "import" | "export";
  acquired_at: string;
  finalized_at: string | null;
  game: "pokemon" | "mtg" | "pokemon_sealed";
  item_type: "single" | "sealed";
  card_id: number | null;
  product_id: number | null;
  condition_id: number | null;
  psa_grade: number | null;
  sealed_condition: string | null;
  variant_edition: string | null;
  name: string;
  english_name: string | null;
  set_code: string;
  card_number: string | null;
  image_url: string | null;
  quantity: number;
  qty_remaining: number;
  qty_sold: number;
  lifecycle_status: "unsold" | "partial" | "sold";
  direct_purchase_cost_usd: number;
  acquisition_cost_alloc_usd: number;
  landed_cost_usd: number;
  on_hand_cost_usd: number;
  gross_usd: number;
  sale_expenses_usd: number;
  net_proceeds_usd: number;
  cogs_usd: number;
  profit_usd: number;
  allocation_snapshot: Record<string, unknown>;
  finalization_snapshot: Record<string, unknown> | null;
  sale_activity: SaleActivity[];
}

export interface InventoryEconomicsTotals {
  directPurchaseUsd: number;
  acquisitionCostsUsd: number;
  landedCostUsd: number;
  onHandCostUsd: number;
  netProceedsUsd: number;
  realizedProfitUsd: number;
}

export function inventoryEconomicsTotals(
  rows: InventoryEconomicsRow[],
): InventoryEconomicsTotals {
  return rows.reduce<InventoryEconomicsTotals>(
    (totals, row) => ({
      directPurchaseUsd:
        totals.directPurchaseUsd + Number(row.direct_purchase_cost_usd),
      acquisitionCostsUsd:
        totals.acquisitionCostsUsd
        + Number(row.acquisition_cost_alloc_usd),
      landedCostUsd: totals.landedCostUsd + Number(row.landed_cost_usd),
      onHandCostUsd: totals.onHandCostUsd + Number(row.on_hand_cost_usd),
      netProceedsUsd:
        totals.netProceedsUsd + Number(row.net_proceeds_usd),
      realizedProfitUsd:
        totals.realizedProfitUsd + Number(row.profit_usd),
    }),
    {
      directPurchaseUsd: 0,
      acquisitionCostsUsd: 0,
      landedCostUsd: 0,
      onHandCostUsd: 0,
      netProceedsUsd: 0,
      realizedProfitUsd: 0,
    },
  );
}
