import { describe, expect, it } from "vitest";
import {
  buildSaleLotRequestShape,
  explicitGrossMatches,
  normalizedSaleExpenseAmount,
  saleEventGroupKey,
  type SaleLotItemInput,
} from "./sale-lot-model";

const items: SaleLotItemInput[] = [
  {
    key: "raw",
    kind: "single",
    game: "pokemon",
    cardId: 11,
    productId: null,
    conditionId: 1,
    psaGrade: 0,
    sealedCondition: null,
    variantEdition: null,
    quantity: 2,
  },
  {
    key: "sealed",
    kind: "sealed",
    game: "pokemon_sealed",
    cardId: null,
    productId: 42,
    conditionId: null,
    psaGrade: null,
    sealedCondition: "shrink",
    variantEdition: "1ed",
    quantity: 1,
  },
];

describe("sale lot source-fact request", () => {
  it("sends one source total shape with visible shared and item expense scope", () => {
    const request = buildSaleLotRequestShape({
      items,
      allocationMethod: "market_value",
      explicitGrossByKey: {},
      sharedExpense: { category: "platform_fee", amount: "7" },
      itemExpensesByKey: {
        sealed: { category: "shipping", amount: "1" },
      },
    });

    expect(request.items).toHaveLength(2);
    expect(request.items[0]).not.toHaveProperty("gross");
    expect(request.items[0]).not.toHaveProperty("fees");
    expect(request.expenses).toEqual([
      {
        category: "platform_fee",
        amount_orig: 7,
        orig_currency: "USD",
        fx_rate_used: 1,
      },
      {
        item_index: 2,
        category: "shipping",
        amount_orig: 1,
        orig_currency: "USD",
        fx_rate_used: 1,
      },
    ]);
  });

  it("includes exact item proceeds only for explicit allocation", () => {
    const request = buildSaleLotRequestShape({
      items,
      allocationMethod: "explicit_prices",
      explicitGrossByKey: { raw: "33.33", sealed: "66.67" },
      sharedExpense: { category: "platform_fee", amount: "0" },
      itemExpensesByKey: {},
    });

    expect(request.items.map((item) => item.explicit_gross)).toEqual([
      33.33,
      66.67,
    ]);
    expect(explicitGrossMatches("100", ["33.33", "66.67"])).toBe(true);
    expect(explicitGrossMatches("100", ["33.33", "66.66"])).toBe(false);
  });

  it("normalizes discounts as negative exact-cent source facts", () => {
    expect(normalizedSaleExpenseAmount("discount_refund", "3.005")).toBe(-3.01);
    expect(normalizedSaleExpenseAmount("shipping", "-3.005")).toBe(3.01);
  });

  it("groups a mixed card and sealed source-fact lot as one sale event", () => {
    const card = saleEventGroupKey({
      key: "pokemon:1",
      game: "pokemon",
      saleGroup: 42,
      sourceFactLot: true,
    });
    const sealed = saleEventGroupKey({
      key: "pokemon_sealed:9",
      game: "pokemon_sealed",
      saleGroup: 42,
      sourceFactLot: true,
    });
    expect(card).toBe(sealed);
    expect(
      saleEventGroupKey({
        key: "pokemon_sealed:9",
        game: "pokemon_sealed",
        saleGroup: 42,
        sourceFactLot: false,
      }),
    ).not.toBe(
      saleEventGroupKey({
        key: "pokemon:1",
        game: "pokemon",
        saleGroup: 42,
        sourceFactLot: false,
      }),
    );
  });
});
