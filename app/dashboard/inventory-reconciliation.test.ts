import { describe, expect, it } from "vitest";
import {
  buildPokemonInventoryShortageArgs,
  inventoryShortage,
  parsePhysicalCount,
  validReconciliationReason,
} from "./inventory-reconciliation";

describe("inventory physical-count reconciliation", () => {
  it("compares the observed count only with the current ledger balance", () => {
    expect(inventoryShortage(5, 3)).toBe(2);
    expect(inventoryShortage(3, 5)).toBeNull();
  });

  it("accepts whole non-negative physical counts", () => {
    expect(parsePhysicalCount("3")).toBe(3);
    expect(parsePhysicalCount(" 0 ")).toBe(0);
    expect(parsePhysicalCount("3.5")).toBeNull();
    expect(parsePhysicalCount("-1")).toBeNull();
  });

  it("builds a scoped shortage request without inventing a sale", () => {
    expect(buildPokemonInventoryShortageArgs({
      cardId: 810212,
      conditionId: 1,
      psaGrade: 0,
      leg: "import",
      ledgerQuantity: 5,
    }, {
      observedQuantity: 3,
      reason: " Physical count reconciliation ",
      notes: " Counted during shelf audit ",
    }, "2026-08-09T17:00:00.000Z")).toEqual({
      p_card_id: 810212,
      p_expected_quantity: 5,
      p_observed_quantity: 3,
      p_reason: "Physical count reconciliation",
      p_adjusted_at: "2026-08-09T17:00:00.000Z",
      p_notes: "Counted during shelf audit",
      p_condition_id: 1,
      p_psa_grade: 0,
      p_leg: "import",
    });
  });

  it("rejects an unchanged count, a surplus, and control characters", () => {
    const scope = {
      cardId: 1,
      conditionId: null,
      psaGrade: null,
      leg: "import" as const,
      ledgerQuantity: 5,
    };
    expect(() => buildPokemonInventoryShortageArgs(scope, {
      observedQuantity: 5,
      reason: "count",
      notes: "",
    }, "2026-08-09T17:00:00Z")).toThrow(/lower/);
    expect(() => buildPokemonInventoryShortageArgs(scope, {
      observedQuantity: 6,
      reason: "count",
      notes: "",
    }, "2026-08-09T17:00:00Z")).toThrow(/lower/);
    expect(validReconciliationReason("bad\nreason")).toBe(false);
  });
});
