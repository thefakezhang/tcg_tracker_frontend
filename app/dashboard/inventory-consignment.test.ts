import { describe, expect, it, vi } from "vitest";
import {
  inventoryConsignmentCounts,
  inventoryConsignmentLinesByHolding,
  normalizedConsignedQty,
  setInventoryLineConsignment,
  type InventoryConsignmentLine,
} from "./inventory-consignment";
import { roiHoldingKey } from "./theoretical-roi";

function line(patch: Partial<InventoryConsignmentLine>): InventoryConsignmentLine {
  return {
    line_key: "pokemon:1",
    lot_line_id: 1,
    lot_id: 10,
    trip_id: 20,
    shop_label: "Card shop",
    acquired_at: "2026-08-01",
    game: "pokemon",
    item_type: "single",
    leg: "import",
    card_id: 100,
    product_id: null,
    condition_id: 2,
    psa_grade: 0,
    sealed_condition: null,
    variant_edition: null,
    qty_on_hand: 3,
    consigned_qty: 1,
    consignee: null,
    consignment_sold_at: null,
    consignment_sale_usd: null,
    consignment_fee_usd: null,
    on_hand_cost_usd: 75,
    exit_unit_usd: null,
    net_pct: null,
    exit_net_usd: null,
    theoretical_profit_usd: null,
    theoretical_roi_pct: null,
    days_held: 4,
    annualized_roi_pct: null,
    below_cost: null,
    age_bucket: "0-30d",
    priced: false,
    ...patch,
  };
}

describe("inventory consignment identity and counts", () => {
  it("keeps leg, grade, condition, and sealed variants in separate holdings", () => {
    const rows = [
      line({ line_key: "pokemon:1", lot_line_id: 1 }),
      line({ line_key: "pokemon:2", lot_line_id: 2, leg: "export" }),
      line({ line_key: "pokemon:3", lot_line_id: 3, condition_id: 4 }),
      line({ line_key: "pokemon:4", lot_line_id: 4, psa_grade: 10 }),
      line({
        game: "pokemon_sealed",
        item_type: "sealed",
        line_key: "pokemon_sealed:5",
        lot_line_id: 5,
        card_id: null,
        product_id: 200,
        condition_id: null,
        psa_grade: null,
        sealed_condition: "shrink",
        variant_edition: "1ed",
      }),
    ];

    const groups = inventoryConsignmentLinesByHolding(rows);

    expect(groups).toHaveLength(5);
    expect(groups.get(roiHoldingKey(rows[4]))?.[0].product_id).toBe(200);
  });

  it("clamps bad stored and entered quantities to copies still on hand", () => {
    expect(normalizedConsignedQty(-2, 3)).toBe(0);
    expect(normalizedConsignedQty(9, 3)).toBe(3);
    expect(normalizedConsignedQty("2.9", 3)).toBe(2);
    expect(normalizedConsignedQty("bad", 3)).toBe(0);

    expect(inventoryConsignmentCounts(4, [
      line({ line_key: "pokemon:1", lot_line_id: 1, qty_on_hand: 2, consigned_qty: 2 }),
      line({ line_key: "pokemon:2", lot_line_id: 2, qty_on_hand: 2, consigned_qty: 9 }),
    ])).toEqual({ owned: 4, consigned: 4, available: 0 });
  });

  it("sorts each holding's source lots newest first", () => {
    const older = line({ line_key: "pokemon:8", lot_line_id: 8, acquired_at: "2026-07-12" });
    const newer = line({ line_key: "pokemon:9", lot_line_id: 9, acquired_at: "2026-07-20" });

    expect(inventoryConsignmentLinesByHolding([older, newer]).get(roiHoldingKey(older)))
      .toEqual([newer, older]);
  });

  it.each([
    ["pokemon", "pokemon:1"],
    ["mtg", "mtg:2"],
    ["pokemon_sealed", "pokemon_sealed:3"],
  ] as const)("saves an exact %s source-line identity", async (game, lineKey) => {
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null });
    const inventoryLine = line({ game, line_key: lineKey, lot_line_id: 37 });

    await expect(setInventoryLineConsignment(inventoryLine, 2, rpc)).resolves.toBe(2);
    expect(rpc).toHaveBeenCalledWith({
      p_game: game,
      p_lot_line_id: 37,
      p_consigned_qty: 2,
    });
  });

  it("surfaces RPC failures and rejects an invalid local quantity", async () => {
    const failure = { code: "23514", message: "line changed" };
    const failedRpc = vi.fn().mockResolvedValue({ data: null, error: failure });

    await expect(setInventoryLineConsignment(line({}), 1, failedRpc)).rejects.toBe(failure);
    await expect(setInventoryLineConsignment(line({ qty_on_hand: 2 }), 3, vi.fn()))
      .rejects.toThrow("integer from 0 to 2");
  });
});
