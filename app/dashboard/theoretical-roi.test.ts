import { describe, it, expect } from "vitest";
import {
  rollupRoi, rollupRoiBy, roiHoldingKey, roiLineKeyFromTable, formatRoiPct,
  type RoiLine,
} from "./theoretical-roi";

function line(over: Partial<RoiLine> = {}): RoiLine {
  return {
    line_key: "pokemon:1",
    lot_line_id: 1,
    lot_id: 1,
    trip_id: 1,
    leg: "import",
    game: "pokemon",
    item_type: "single",
    card_id: 100,
    product_id: null,
    condition_id: 1,
    psa_grade: 0,
    sealed_condition: null,
    variant_edition: null,
    qty_on_hand: 1,
    on_hand_cost_usd: 100,
    exit_unit_usd: 200,
    exit_net_usd: 160,
    theoretical_profit_usd: 60,
    theoretical_roi_pct: 60,
    days_held: 10,
    annualized_roi_pct: null,
    below_cost: false,
    age_bucket: "0-30d",
    priced: true,
    ...over,
  };
}

describe("rollupRoi", () => {
  it("returns the plain return when every line is priced", () => {
    const s = rollupRoi([line(), line({ line_key: "pokemon:2" })]);
    expect(s.priced).toBe(2);
    expect(s.costUsd).toBe(200);
    expect(s.netUsd).toBe(320);
    expect(s.profitUsd).toBe(120);
    expect(s.roiPct).toBe(60);
  });

  // The whole point of `priced`: an unpriced line is UNKNOWN, not worthless.
  // Folding its cost into the denominator with a $0 exit would drag a healthy
  // return toward -100% and make the operator think the stock had collapsed.
  it("excludes unpriced lines from both sides of the ratio", () => {
    const s = rollupRoi([
      line(),
      line({
        line_key: "pokemon:2", priced: false, on_hand_cost_usd: 900,
        exit_unit_usd: null, exit_net_usd: null, theoretical_profit_usd: null,
        theoretical_roi_pct: null, below_cost: null,
      }),
    ]);
    expect(s.lines).toBe(2);
    expect(s.priced).toBe(1);
    expect(s.unpriced).toBe(1);
    // Carrying cost still reports EVERYTHING - that is what the books hold.
    expect(s.costUsd).toBe(1000);
    // ...but the ratio only sees the line it can actually value.
    expect(s.pricedCostUsd).toBe(100);
    expect(s.roiPct).toBe(60);
  });

  // The export leg has no trustworthy JP market feed, so every line comes back
  // unpriced. "Not valued" must survive as null; 0% would be a claim.
  it("reports null ROI when nothing in the group is priced", () => {
    const s = rollupRoi([
      line({ leg: "export", priced: false, exit_net_usd: null, theoretical_roi_pct: null }),
    ]);
    expect(s.priced).toBe(0);
    expect(s.roiPct).toBeNull();
    expect(s.netUsd).toBe(0);
  });

  it("counts below-cost lines and their carrying cost", () => {
    const s = rollupRoi([
      line(),
      line({ line_key: "pokemon:2", exit_net_usd: 40, theoretical_roi_pct: -60, below_cost: true }),
    ]);
    expect(s.belowCost).toBe(1);
    expect(s.belowCostUsd).toBe(100);
    expect(s.profitUsd).toBe(0);
    expect(s.roiPct).toBe(0);
  });

  it("is empty-safe", () => {
    const s = rollupRoi([]);
    expect(s.lines).toBe(0);
    expect(s.roiPct).toBeNull();
  });
});

describe("rollupRoiBy", () => {
  it("keeps groups independent", () => {
    const groups = rollupRoiBy(
      [
        line({ lot_id: 1 }),
        line({ line_key: "pokemon:2", lot_id: 1 }),
        line({ line_key: "pokemon:3", lot_id: 2, on_hand_cost_usd: 50, exit_net_usd: 50, theoretical_roi_pct: 0 }),
      ],
      (l) => String(l.lot_id),
    );
    expect(groups.get("1")!.roiPct).toBe(60);
    expect(groups.get("2")!.roiPct).toBe(0);
  });
});

describe("roiHoldingKey", () => {
  // inventory_holdings_v splits singles by condition and grade; if the key
  // ignored either, a PSA 10 would inherit a raw copy's return.
  it("separates grades and conditions", () => {
    const base = { game: "pokemon", leg: "import", card_id: 1, condition_id: 1, psa_grade: 0 };
    expect(roiHoldingKey(base)).not.toBe(roiHoldingKey({ ...base, psa_grade: 10 }));
    expect(roiHoldingKey(base)).not.toBe(roiHoldingKey({ ...base, condition_id: 2 }));
  });

  it("separates legs, so the same card bought both ways stays split", () => {
    const base = { game: "pokemon", leg: "import", card_id: 1, condition_id: 1, psa_grade: 0 };
    expect(roiHoldingKey(base)).not.toBe(roiHoldingKey({ ...base, leg: "export" }));
  });

  it("keys sealed on its own two axes", () => {
    const base = { game: "pokemon_sealed", leg: "import", product_id: 7, sealed_condition: "shrink", variant_edition: "1ED" };
    expect(roiHoldingKey(base)).not.toBe(roiHoldingKey({ ...base, sealed_condition: "no_shrink" }));
    expect(roiHoldingKey(base)).not.toBe(roiHoldingKey({ ...base, variant_edition: "UNL" }));
  });
});

describe("roiLineKeyFromTable", () => {
  // line_id is only unique within its own table, so the game must be in the key.
  it("namespaces the line id by game", () => {
    expect(roiLineKeyFromTable("pokemon_lot_lines", 5)).toBe("pokemon:5");
    expect(roiLineKeyFromTable("mtg_lot_lines", 5)).toBe("mtg:5");
    expect(roiLineKeyFromTable("pokemon_sealed_lot_lines", 5)).toBe("pokemon_sealed:5");
  });
});

describe("formatRoiPct", () => {
  it("signs the number and marks the unknown case", () => {
    expect(formatRoiPct(59.74)).toBe("+59.7%");
    expect(formatRoiPct(-12)).toBe("-12.0%");
    expect(formatRoiPct(null)).toBe("-");
  });
});
