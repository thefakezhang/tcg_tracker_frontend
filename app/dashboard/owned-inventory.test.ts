import { describe, expect, it } from "vitest";
import {
  ownedInventoryCountMap,
  ownedInventoryKey,
} from "./owned-inventory";

describe("owned inventory identity", () => {
  it("uses one quiet singles count across grade, condition, leg, and lots", () => {
    const counts = ownedInventoryCountMap([
      {
        game: "pokemon",
        card_id: 42,
        product_id: null,
        sealed_condition: null,
        variant_edition: null,
        qty_owned: 7,
      },
    ]);

    expect(
      counts.get(ownedInventoryKey({ game: "pokemon", cardId: 42 })),
    ).toBe(7);
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
      },
      {
        game: "pokemon_sealed",
        card_id: null,
        product_id: 99,
        sealed_condition: "no_shrink",
        variant_edition: "unlimited",
        qty_owned: 1,
      },
    ]);

    expect(counts.get(ownedInventoryKey({
      game: "pokemon_sealed",
      productId: 99,
      sealedCondition: "shrink",
      variantEdition: "1ed",
    }))).toBe(2);
    expect(counts.get(ownedInventoryKey({
      game: "pokemon_sealed",
      productId: 99,
      sealedCondition: "no_shrink",
      variantEdition: "unlimited",
    }))).toBe(1);
  });
});
