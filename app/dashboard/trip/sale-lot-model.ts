export type SaleAllocationMethod =
  | "market_value"
  | "landed_cost"
  | "equal_per_unit"
  | "explicit_prices";

export type SaleExpenseCategory =
  | "platform_fee"
  | "shipping"
  | "handling"
  | "insurance"
  | "tax_duty"
  | "travel"
  | "discount_refund"
  | "custom";

export interface SaleLotItemInput {
  key: string;
  kind: "single" | "sealed";
  game: string;
  cardId: number | null;
  productId: number | null;
  conditionId: number | null;
  psaGrade: number | null;
  sealedCondition: string | null;
  variantEdition: string | null;
  quantity: number;
}

export interface SaleLotExpenseInput {
  category: SaleExpenseCategory;
  amount: string | number;
}

export interface SaleLotRequestShape {
  items: Array<Record<string, unknown>>;
  expenses: Array<Record<string, unknown>>;
}

function cents(value: string | number | undefined): number {
  return Math.round((Number(value) || 0) * 100);
}

export function normalizedSaleExpenseAmount(
  category: SaleExpenseCategory,
  amount: string | number,
): number {
  const absoluteCents = Math.round(Math.abs(Number(amount) || 0) * 100);
  const signedCents =
    category === "discount_refund" ? -absoluteCents : absoluteCents;
  return signedCents / 100;
}

export function explicitGrossMatches(
  grossTotal: string | number,
  itemGross: Array<string | number | undefined>,
): boolean {
  return (
    itemGross.reduce<number>((sum, value) => sum + cents(value), 0) ===
    cents(grossTotal)
  );
}

export function saleEventGroupKey({
  key,
  game,
  saleGroup,
  sourceFactLot,
}: {
  key: string;
  game: string;
  saleGroup: number | null;
  sourceFactLot: boolean;
}): string {
  if (saleGroup == null) return `sale:${key}`;
  if (sourceFactLot) return `source-lot:${saleGroup}`;
  return `legacy-lot:${game}:${saleGroup}`;
}

export function buildSaleLotRequestShape({
  items,
  allocationMethod,
  explicitGrossByKey,
  sharedExpense,
  itemExpensesByKey,
}: {
  items: SaleLotItemInput[];
  allocationMethod: SaleAllocationMethod;
  explicitGrossByKey: Record<string, string>;
  sharedExpense: SaleLotExpenseInput;
  itemExpensesByKey: Record<string, SaleLotExpenseInput>;
}): SaleLotRequestShape {
  const requestItems = items.map((item) => ({
    kind: item.kind,
    game: item.game,
    card_id: item.cardId,
    condition_id: item.conditionId,
    psa_grade: item.psaGrade ?? 0,
    product_id: item.productId,
    sealed_condition: item.sealedCondition,
    variant_edition: item.variantEdition,
    quantity: item.quantity,
    ...(allocationMethod === "explicit_prices"
      ? { explicit_gross: Number(explicitGrossByKey[item.key]) }
      : {}),
  }));

  const expenses: Array<Record<string, unknown>> = [];
  if (cents(sharedExpense.amount) !== 0) {
    expenses.push({
      category: sharedExpense.category,
      amount_orig: normalizedSaleExpenseAmount(
        sharedExpense.category,
        sharedExpense.amount,
      ),
      orig_currency: "USD",
      fx_rate_used: 1,
    });
  }
  items.forEach((item, index) => {
    const expense = itemExpensesByKey[item.key];
    if (!expense || cents(expense.amount) === 0) return;
    expenses.push({
      item_index: index + 1,
      category: expense.category,
      amount_orig: normalizedSaleExpenseAmount(
        expense.category,
        expense.amount,
      ),
      orig_currency: "USD",
      fx_rate_used: 1,
    });
  });

  return { items: requestItems, expenses };
}
