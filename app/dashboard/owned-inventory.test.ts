import { describe, expect, it } from "vitest";
import {
  ownedInventoryCountMap,
  ownedInventoryKey,
} from "./owned-inventory";

describe("owned inventory identity", () => {
  it("uses one quiet singles count across grade, condition, leg, and lots, with landed cost", () => {
    const counts = ownedInventoryCountMap([
      {
        game: "pokemon",
        card_id: 42,
        product_id: null,
        sealed_condition: null,
        variant_edition: null,
        qty_owned: 7,
        qty_incoming: 0,
        cost_basis_usd: 70,
        avg_cost_usd: 10,
      },
    ]);

    expect(
      counts.get(ownedInventoryKey({ game: "pokemon", cardId: 42 })),
    ).toEqual({ owned: 7, incoming: 0, costBasis: 70, avgCost: 10, consigned: 0, available: 7 });
  });

  it("keeps draft-lot copies separate as incoming, never folded into owned", () => {
    const counts = ownedInventoryCountMap([
      {
        game: "pokemon",
        card_id: 7,
        product_id: null,
        sealed_condition: null,
        variant_edition: null,
        qty_owned: 1,
        qty_incoming: 2,
        cost_basis_usd: 15,
        avg_cost_usd: 15,
      },
      {
        game: "pokemon",
        card_id: 8,
        product_id: null,
        sealed_condition: null,
        variant_edition: null,
        qty_owned: 0,
        qty_incoming: 3,
        // Nothing owned yet (draft only): no cost basis, no average.
        cost_basis_usd: 0,
        avg_cost_usd: null,
      },
    ]);

    expect(
      counts.get(ownedInventoryKey({ game: "pokemon", cardId: 7 })),
    ).toEqual({ owned: 1, incoming: 2, costBasis: 15, avgCost: 15, consigned: 0, available: 1 });
    expect(
      counts.get(ownedInventoryKey({ game: "pokemon", cardId: 8 })),
    ).toEqual({ owned: 0, incoming: 3, costBasis: 0, avgCost: null, consigned: 0, available: 0 });
  });

  it("keeps sealed condition and edition in the visible inventory identity", () => {
    const counts = ownedInventoryCountMap([
      {
        game: "pokemon_sealed",
        card_id: null,
        product_id: 99,
        sealed_condition: "shrink",
        variant_edition: "1ed",
        qty_owned: 2,
        qty_incoming: 0,
        cost_basis_usd: 50,
        avg_cost_usd: 25,
      },
      {
        game: "pokemon_sealed",
        card_id: null,
        product_id: 99,
        sealed_condition: "no_shrink",
        variant_edition: "unlimited",
        qty_owned: 1,
        qty_incoming: 1,
        cost_basis_usd: 30,
        avg_cost_usd: 30,
      },
    ]);

    expect(counts.get(ownedInventoryKey({
      game: "pokemon_sealed",
      productId: 99,
      sealedCondition: "shrink",
      variantEdition: "1ed",
    }))).toEqual({ owned: 2, incoming: 0, costBasis: 50, avgCost: 25, consigned: 0, available: 2 });
    expect(counts.get(ownedInventoryKey({
      game: "pokemon_sealed",
      productId: 99,
      sealedCondition: "no_shrink",
      variantEdition: "unlimited",
    }))).toEqual({ owned: 1, incoming: 1, costBasis: 30, avgCost: 30, consigned: 0, available: 1 });
  });
});
