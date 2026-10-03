import { describe, expect, it } from "vitest";
import {
  lotLineGradeLabel,
  mapSealedLotLine,
  mapSingleLotLine,
  sealedLotLineInsert,
} from "./lot-line-model";

describe("saved lot-line grade round trip", () => {
  it("preserves PSA 10 when a saved row is fetched and rendered", () => {
    const line = mapSingleLotLine(
      {
        line_id: 353,
        card_id: 1841297,
        condition_id: 1,
        psa_grade: 10,
        quantity: 1,
        price_override_usd: 100,
        allocated_cost_usd: 0,
      },
      "pokemon_lot_lines",
    );

    expect(line.psa_grade).toBe(10);
    expect(lotLineGradeLabel(line.psa_grade)).toBe("PSA 10");
  });

  it("labels grade zero as Raw", () => {
    expect(lotLineGradeLabel(0)).toBe("Raw");
  });
});

describe("saved sealed lot-line round trip", () => {
  it("preserves selection axes from insert through reload mapping", () => {
    const insert = sealedLotLineInsert({
      lotId: 287,
      productId: 42,
      sealedCondition: "shrink",
      variantEdition: "1ed",
      quantity: 3,
      overrideUsd: 27.5,
    });

    expect(insert).toEqual({
      lot_id: 287,
      product_id: 42,
      sealed_condition: "shrink",
      variant_edition: "1ed",
      quantity: 3,
      price_override_usd: 27.5,
      market_value_usd: null,
    });

    const line = mapSealedLotLine(
      {
        line_id: 7,
        product_id: Number(insert.product_id),
        sealed_condition: insert.sealed_condition,
        variant_edition: insert.variant_edition,
        quantity: insert.quantity,
        price_override_usd: insert.price_override_usd,
        allocated_cost_usd: 0,
      },
      "pokemon_sealed_lot_lines",
    );

    expect(line).toMatchObject({
      product_id: 42,
      sealed_condition: "shrink",
      variant_edition: "1ed",
      sealedLabel: "shrink/1ed",
      quantity: 3,
      price_override_usd: 27.5,
    });
  });
});

describe("bulk market value default", () => {
  // Unsorted bulk has no market price and never will, so finalization refuses
  // it outright beside any other line (tcg_tracker migrations 000527/000528)
  // rather than silently allocating it $0 or, by quantity weight, the whole
  // lot. A new bulk line is therefore seeded with a nominal per-card value.
  it("seeds a weight rather than pinning a cost", () => {
    const insert = sealedLotLineInsert({
      lotId: 1,
      productId: 2719,
      productType: "bulk",
      sealedCondition: "standard",
      variantEdition: "standard",
      quantity: 60,
    });
    expect(insert.market_value_usd).toBe(0.1);
    // Must NOT pin. A pin has to reconcile to the lot total, so a bulk-only
    // lot would be refused whenever qty x rate missed it - 2000 x $0.10 =
    // $200.00 against a $204.00 lot. A weight never has to reconcile.
    expect(insert.price_override_usd).toBeNull();
  });

  it("leaves a non-bulk sealed line unvalued", () => {
    const insert = sealedLotLineInsert({
      lotId: 1,
      productId: 1577,
      sealedCondition: "standard",
      variantEdition: "standard",
      quantity: 1,
    });
    expect(insert.market_value_usd).toBeNull();
    expect(insert.price_override_usd).toBeNull();
  });
});
