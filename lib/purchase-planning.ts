export type PlanStatus = "draft" | "ready" | "ordered" | "cancelled";
export type DemandIntent = "interest" | "requested" | "committed";
export type DemandType = "wishlist" | "criteria";

export interface PurchasePlan {
  plan_id: number;
  name: string;
  trip_id: number | null;
  status: PlanStatus;
  budget_currency: string;
  budget_amount: number | null;
  notes: string | null;
  created_at: string;
  reviewed_at: string | null;
  ordered_at: string | null;
}

export interface PrimaryCustomer {
  allocation_id: number;
  customer_id: number | null;
  customer_name: string | null;
  quantity: number;
  status: string;
  intent: DemandIntent | null;
}

export interface PurchasePlanLine {
  plan_line_id: number;
  plan_id: number;
  game: string;
  card_id: number | null;
  product_id: number | null;
  psa_grade: number | null;
  condition_id: number | null;
  planned_quantity: number;
  source: string | null;
  source_listing_url: string | null;
  source_external_id: string | null;
  source_available_quantity: number | null;
  unit_price_orig: number | null;
  currency: string | null;
  landed_unit_cost_usd: number | null;
  source_observed_at: string | null;
  analysis_snapshot: Record<string, unknown>;
  status: string;
  notes: string | null;
  item_name: string;
  set_code: string | null;
  card_number: string | null;
  misc_info: string | null;
  primary_quantity: number;
  backup_count: number;
  primary_customers: PrimaryCustomer[];
  speculative_quantity: number;
}

export interface DemandOrigin {
  type: DemandType;
  id: number;
  intent: DemandIntent;
  priority: number;
  target_quantity: number;
  remaining_quantity: number;
  ceiling_usd: number | null;
  label: string;
}

export interface PurchaseCandidate {
  plan_id: number;
  plan_line_id: number;
  customer_id: number;
  customer_name: string;
  strongest_intent: DemandIntent;
  top_priority: number;
  remaining_demand_quantity: number;
  top_customer_ceiling_usd: number | null;
  best_direct_margin_usd: number | null;
  demand_origins: DemandOrigin[];
}

export interface PurchaseAllocation {
  allocation_id: number;
  plan_id: number;
  plan_line_id: number;
  customer_id: number | null;
  customer_name: string | null;
  wishlist_id: number | null;
  criteria_id: number | null;
  role: "primary" | "backup";
  backup_rank: number | null;
  backs_up_allocation_id: number | null;
  quantity: number;
  status: string;
  proposed_sale_price_usd: number | null;
  agreed_sale_price_usd: number | null;
  demand_snapshot: Record<string, unknown>;
  demand_label: string;
}

export interface DemandCoverage {
  plan_id: number;
  customer_id: number;
  customer_name: string;
  demand_type: DemandType;
  demand_id: number;
  demand_label: string;
  intent: Exclude<DemandIntent, "interest">;
  priority: number;
  target_quantity: number;
  covered_this_plan: number;
  covered_other_plans: number;
  remaining_uncovered: number;
  coverage_state: "covered" | "partial" | "covered_elsewhere" | "deferred" | "unavailable" | "out_of_scope" | "unreviewed";
  disposition_note: string | null;
}

export interface PlanValidationItem {
  code: string;
  line_id: number | null;
  detail: string;
}

export interface PlanValidation {
  valid: boolean;
  blockers: PlanValidationItem[];
  warnings: PlanValidationItem[];
  summary: {
    line_count: number;
    planned_quantity: number;
    primary_quantity: number;
    speculative_quantity: number;
    landed_total_usd: number;
  };
}

export function intentRank(intent: DemandIntent): number {
  if (intent === "committed") return 0;
  if (intent === "requested") return 1;
  return 2;
}

export function sortedOrigins(origins: DemandOrigin[]): DemandOrigin[] {
  return [...origins].sort(
    (a, b) => intentRank(a.intent) - intentRank(b.intent) || a.priority - b.priority || a.id - b.id,
  );
}

export function summarizePlan(lines: PurchasePlanLine[], coverage: DemandCoverage[], allocations: PurchaseAllocation[]) {
  const activeLines = lines.filter((line) => line.status === "planned" || line.status === "ordered");
  const primary = allocations.filter(
    (allocation) =>
      allocation.role === "primary" &&
      ["planned", "ordered", "reserved", "fulfilled"].includes(allocation.status),
  );
  const committedUnits = primary.reduce(
    (sum, allocation) => sum + (allocation.demand_snapshot.intent === "committed" ? allocation.quantity : 0),
    0,
  );
  const requestedUnits = primary.reduce(
    (sum, allocation) => sum + (allocation.demand_snapshot.intent === "requested" ? allocation.quantity : 0),
    0,
  );
  return {
    lineCount: activeLines.length,
    plannedUnits: activeLines.reduce((sum, line) => sum + Number(line.planned_quantity), 0),
    speculativeUnits: activeLines.reduce((sum, line) => sum + Number(line.speculative_quantity), 0),
    landedTotalUsd: activeLines.reduce(
      (sum, line) => sum + Number(line.landed_unit_cost_usd ?? 0) * Number(line.planned_quantity),
      0,
    ),
    committedUnits,
    requestedUnits,
    coveredCustomers: new Set(
      coverage.filter((row) => row.coverage_state === "covered").map((row) => row.customer_id),
    ).size,
    uncoveredCustomers: new Set(
      coverage
        .filter((row) => ["partial", "unavailable", "unreviewed"].includes(row.coverage_state))
        .map((row) => row.customer_id),
    ).size,
  };
}
