export interface SingleLotLineRow {
  line_id: number;
  card_id: number;
  condition_id: number;
  psa_grade: number;
  quantity: number;
  price_override_usd: number | null;
  allocated_cost_usd: number;
  direct_purchase_cost_usd?: number;
  acquisition_cost_alloc_usd?: number;
  // FIFO copies still on hand; null on a draft (un-finalized) lot.
  qty_remaining?: number | null;
}

export interface SingleLotLineDefinition {
  regionalName: string;
  englishName: string | null;
  setCode: string;
  cardNumber: string | null;
  // The composed variant label (cardVariant), not the stored misc_info.
  variantLabel: string | null;
  imageUrl: string | null;
}

export interface SealedLotLineRow {
  line_id: number;
  product_id: number;
  sealed_condition: string;
  variant_edition: string;
  quantity: number;
  price_override_usd: number | null;
  market_value_usd?: number | null;
  allocated_cost_usd: number;
  direct_purchase_cost_usd?: number;
  acquisition_cost_alloc_usd?: number;
  qty_remaining?: number | null;
}

export interface SealedLotLineDefinition {
  name: string;
  setCode: string;
  imageUrl: string | null;
}

export interface SealedLotLineInput {
  lotId: number;
  productId: string | number;
  productType?: string | null;
  sealedCondition: string;
  variantEdition: string;
  quantity: number;
  overrideUsd?: number | null;
  marketValueUsd?: number | null;
}

// Unsorted bulk has no observed market price, but finalization refuses an
// unvalued bulk line beside any other line. This nominal per-card value is an
// editable allocation weight, not a pinned cost or market observation.
export const BULK_DEFAULT_MARKET_USD = 0.1;

export function lotLineGradeLabel(psaGrade: number): string {
  return psaGrade > 0 ? `PSA ${psaGrade}` : "Raw";
}

export function sealedLotLineInsert(input: SealedLotLineInput) {
  return {
    lot_id: input.lotId,
    product_id: input.productId,
    sealed_condition: input.sealedCondition,
    variant_edition: input.variantEdition,
    quantity: input.quantity,
    price_override_usd: input.overrideUsd ?? null,
    market_value_usd:
      input.marketValueUsd ??
      (input.productType === "bulk" ? BULK_DEFAULT_MARKET_USD : null),
  };
}

export function mapSingleLotLine(
  row: SingleLotLineRow,
  table: string,
  definition?: SingleLotLineDefinition,
) {
  return {
    line_id: row.line_id,
    table,
    kind: "single" as const,
    card_id: row.card_id,
    quantity: row.quantity,
    condition_id: row.condition_id,
    psa_grade: row.psa_grade,
    price_override_usd: row.price_override_usd,
    allocated_cost_usd: row.allocated_cost_usd,
    direct_purchase_cost_usd: row.direct_purchase_cost_usd ?? 0,
    acquisition_cost_alloc_usd: row.acquisition_cost_alloc_usd ?? 0,
    qty_remaining: row.qty_remaining ?? null,
    regionalName: definition?.regionalName ?? `#${row.card_id}`,
    englishName: definition?.englishName ?? null,
    setCode: definition?.setCode ?? "",
    cardNumber: definition?.cardNumber ?? null,
    variantLabel: definition?.variantLabel ?? null,
    imageUrl: definition?.imageUrl ?? null,
  };
}

export function mapSealedLotLine(
  row: SealedLotLineRow,
  table: string,
  definition?: SealedLotLineDefinition,
) {
  return {
    line_id: row.line_id,
    table,
    kind: "sealed" as const,
    product_id: row.product_id,
    quantity: row.quantity,
    sealed_condition: row.sealed_condition,
    variant_edition: row.variant_edition,
    sealedLabel: `${row.sealed_condition}/${row.variant_edition}`,
    price_override_usd: row.price_override_usd,
    market_value_usd: row.market_value_usd ?? null,
    allocated_cost_usd: row.allocated_cost_usd,
    direct_purchase_cost_usd: row.direct_purchase_cost_usd ?? 0,
    acquisition_cost_alloc_usd: row.acquisition_cost_alloc_usd ?? 0,
    qty_remaining: row.qty_remaining ?? null,
    regionalName: definition?.name ?? `#${row.product_id}`,
    englishName: null,
    setCode: definition?.setCode ?? "",
    cardNumber: null,
    variantLabel: null,
    imageUrl: definition?.imageUrl ?? null,
  };
}
