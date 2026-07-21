import { describe, expect, it } from "vitest";
import { sortedOrigins, summarizePlan, type DemandCoverage, type PurchaseAllocation, type PurchasePlanLine } from "./purchase-planning";

describe("purchase planning helpers", () => {
  it("orders committed exact demand before softer criteria demand", () => {
    expect(
      sortedOrigins([
        { type: "criteria", id: 9, intent: "interest", priority: 1, target_quantity: 1, remaining_quantity: 1, ceiling_usd: 200, label: "ARs" },
        { type: "wishlist", id: 2, intent: "committed", priority: 2, target_quantity: 1, remaining_quantity: 1, ceiling_usd: 150, label: "Exact" },
        { type: "wishlist", id: 3, intent: "requested", priority: 1, target_quantity: 1, remaining_quantity: 1, ceiling_usd: 175, label: "Request" },
      ]).map((origin) => origin.id),
    ).toEqual([2, 3, 9]);
  });

  it("keeps committed, requested, and speculative quantities separate", () => {
    const lines = [
      { status: "planned", planned_quantity: 3, speculative_quantity: 1, landed_unit_cost_usd: 100 },
    ] as unknown as PurchasePlanLine[];
    const allocations = [
      { role: "primary", status: "planned", quantity: 1, demand_snapshot: { intent: "committed" } },
      { role: "primary", status: "planned", quantity: 1, demand_snapshot: { intent: "requested" } },
      { role: "backup", status: "planned", quantity: 1, demand_snapshot: { intent: "interest" } },
    ] as unknown as PurchaseAllocation[];
    const coverage = [
      { customer_id: 1, coverage_state: "covered" },
      { customer_id: 2, coverage_state: "partial" },
    ] as unknown as DemandCoverage[];

    expect(summarizePlan(lines, coverage, allocations)).toMatchObject({
      plannedUnits: 3,
      speculativeUnits: 1,
      landedTotalUsd: 300,
      committedUnits: 1,
      requestedUnits: 1,
      coveredCustomers: 1,
      uncoveredCustomers: 1,
    });
  });
});
