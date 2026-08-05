"use client";

import { createClient } from "@/lib/supabase/client";
import { selectAll } from "@/lib/supabase/select-all";

// Theoretical (mark-to-market) ROI on inventory still on hand, read from
// inventory_theoretical_roi_v (migration 000224). One row per lot line.
//
// This is a MANAGEMENT metric, not an accounting one: standard inventory
// accounting carries stock at lower-of-cost-or-NRV and never writes it up, so
// none of this belongs in the P&L or balance sheet (those keep using the cost
// pool). It answers "what could the unsold stock return if I sold it today",
// which is the buying decision, not the books.
//
// Two honesty rules the whole UI depends on, enforced here rather than in each
// consumer:
//   1. Unpriced lines are never zero-filled. A line with no exit quote is
//      excluded from BOTH sides of the ratio and counted in `unpriced`, so a
//      caller can say "based on N of M". Silently folding a $0 exit into the
//      numerator would understate every rollup.
//   2. The export leg is deliberately unpriced upstream (no trustworthy JP
//      market feed yet - the best JP "bid" for vintage resolves to a retail
//      ASK). Export rollups therefore come back with priced=0, and the UI must
//      say "not valued", not "0%".

export interface RoiLine {
  line_key: string;
  lot_line_id: number;
  lot_id: number;
  trip_id: number | null;
  shop_label: string | null;
  acquired_at: string | null;
  leg: string;
  game: string;
  item_type: "single" | "sealed";
  card_id: number | null;
  product_id: number | null;
  condition_id: number | null;
  psa_grade: number | null;
  sealed_condition: string | null;
  variant_edition: string | null;
  qty_on_hand: number;
  consigned_qty: number;
  on_hand_cost_usd: number | null;
  /** Gross market price per copy - the bid BEFORE the fee assumption. */
  exit_unit_usd: number | null;
  /** Fraction of gross assumed to survive fees (0.80 today, uniform). */
  net_pct: number | null;
  /** exit_unit_usd * qty * net_pct. Every ROI figure is built on THIS. */
  exit_net_usd: number | null;
  theoretical_profit_usd: number | null;
  theoretical_roi_pct: number | null;
  days_held: number | null;
  annualized_roi_pct: number | null;
  below_cost: boolean | null;
  age_bucket: string | null;
  priced: boolean;
}

const COLUMNS =
  "line_key, lot_line_id, lot_id, trip_id, shop_label, acquired_at, leg, game, item_type, card_id, product_id, " +
  "condition_id, psa_grade, sealed_condition, variant_edition, qty_on_hand, on_hand_cost_usd, " +
  "consigned_qty, exit_unit_usd, net_pct, exit_net_usd, theoretical_profit_usd, theoretical_roi_pct, days_held, " +
  "annualized_roi_pct, below_cost, age_bucket, priced";

const num = (v: unknown): number | null => (v == null ? null : Number(v));

function normalize(row: Record<string, unknown>): RoiLine {
  const qtyOnHand = Math.max(0, Math.floor(Number(row.qty_on_hand) || 0));
  const storedConsigned = Math.floor(Number(row.consigned_qty) || 0);
  return {
    ...(row as unknown as RoiLine),
    qty_on_hand: qtyOnHand,
    consigned_qty: Math.max(0, Math.min(storedConsigned, qtyOnHand)),
    on_hand_cost_usd: num(row.on_hand_cost_usd),
    exit_unit_usd: num(row.exit_unit_usd),
    net_pct: num(row.net_pct),
    exit_net_usd: num(row.exit_net_usd),
    theoretical_profit_usd: num(row.theoretical_profit_usd),
    theoretical_roi_pct: num(row.theoretical_roi_pct),
    days_held: num(row.days_held),
    annualized_roi_pct: num(row.annualized_roi_pct),
    priced: row.priced === true,
  };
}

export interface RoiFilter {
  lotId?: number;
  tripId?: number;
  leg?: string;
}

// Paged, because a wide filter (a whole leg across trips) can exceed
// PostgREST's 1000-row cap and a dropped line would quietly shrink the rollup.
export async function fetchRoiLines(filter: RoiFilter = {}): Promise<RoiLine[]> {
  const supabase = createClient();
  const rows = await selectAll<Record<string, unknown>>(
    () => {
      let q = supabase.from("inventory_theoretical_roi_v").select(COLUMNS);
      if (filter.lotId != null) q = q.eq("lot_id", filter.lotId);
      if (filter.tripId != null) q = q.eq("trip_id", filter.tripId);
      if (filter.leg) q = q.eq("leg", filter.leg);
      return q;
    },
    ["line_key"],
  );
  return rows.map(normalize);
}

export interface RoiSummary {
  /** Lines in the group, and how many of them carry an exit quote. */
  lines: number;
  priced: number;
  unpriced: number;
  /** Copies on hand across the group (all lines, priced or not). */
  qty: number;
  /** Carrying cost of ALL lines - what the books actually hold. */
  costUsd: number;
  /** Carrying cost of the PRICED lines only: the ROI denominator. */
  pricedCostUsd: number;
  /** Gross market value of the priced lines, BEFORE the fee assumption. */
  grossUsd: number;
  /** Net proceeds of the priced lines at the flat fee assumption. */
  netUsd: number;
  /**
   * The fee assumption behind netUsd, as a fraction (0.80). Null when the
   * group is empty or - once fees ever go per-platform - when its lines do
   * NOT share one rate, so a caller can never print a single rate that only
   * some of the figure was built on.
   */
  netPct: number | null;
  profitUsd: number;
  /** Null when nothing in the group is priced (e.g. the whole export leg). */
  roiPct: number | null;
  /** Lines whose net realizable value has fallen under carrying cost. */
  belowCost: number;
  belowCostUsd: number;
}

export function rollupRoi(lines: readonly RoiLine[]): RoiSummary {
  let priced = 0, qty = 0, costUsd = 0, pricedCostUsd = 0, netUsd = 0, grossUsd = 0;
  let belowCost = 0, belowCostUsd = 0;
  const rates = new Set<number>();
  for (const l of lines) {
    const cost = Number(l.on_hand_cost_usd ?? 0);
    qty += Number(l.qty_on_hand ?? 0);
    costUsd += cost;
    if (!l.priced) continue;
    priced += 1;
    pricedCostUsd += cost;
    netUsd += Number(l.exit_net_usd ?? 0);
    grossUsd += Number(l.exit_unit_usd ?? 0) * Number(l.qty_on_hand ?? 0);
    if (l.net_pct != null) rates.add(l.net_pct);
    if (l.below_cost) { belowCost += 1; belowCostUsd += cost; }
  }
  return {
    grossUsd,
    netPct: rates.size === 1 ? [...rates][0] : null,
    lines: lines.length,
    priced,
    unpriced: lines.length - priced,
    qty,
    costUsd,
    pricedCostUsd,
    netUsd,
    profitUsd: netUsd - pricedCostUsd,
    roiPct: pricedCostUsd > 0 ? ((netUsd - pricedCostUsd) / pricedCostUsd) * 100 : null,
    belowCost,
    belowCostUsd,
  };
}

/** Group lines by an arbitrary key, then roll each group up. */
export function rollupRoiBy(
  lines: readonly RoiLine[],
  keyOf: (line: RoiLine) => string,
): Map<string, RoiSummary> {
  const groups = new Map<string, RoiLine[]>();
  for (const l of lines) {
    const k = keyOf(l);
    const bucket = groups.get(k);
    if (bucket) bucket.push(l); else groups.set(k, [l]);
  }
  const out = new Map<string, RoiSummary>();
  for (const [k, group] of groups) out.set(k, rollupRoi(group));
  return out;
}

// The identity inventory_holdings_v groups on, so a holdings row can look up
// its own theoretical figures. Singles split by condition and grade; sealed
// splits by its own two axes and has no condition_id.
export interface RoiHoldingIdentity {
  game: string;
  leg: string;
  card_id?: number | null;
  product_id?: number | null;
  condition_id?: number | null;
  psa_grade?: number | null;
  sealed_condition?: string | null;
  variant_edition?: string | null;
}

export function roiHoldingKey(h: RoiHoldingIdentity): string {
  return [
    h.game,
    h.leg,
    h.card_id ?? "",
    h.product_id ?? "",
    h.condition_id ?? "",
    h.psa_grade ?? 0,
    h.sealed_condition ?? "",
    h.variant_edition ?? "",
  ].join("|");
}

/** Keyed by (game, line_id) - line_id is only unique within its own table. */
export function roiLineKeyFromTable(table: string, lineId: number): string {
  const game =
    table === "pokemon_lot_lines" ? "pokemon"
    : table === "mtg_lot_lines" ? "mtg"
    : table === "pokemon_sealed_lot_lines" ? "pokemon_sealed"
    : table;
  return `${game}:${lineId}`;
}

/** Signed percentage, e.g. "+59.7%" / "-12.0%". */
export function formatRoiPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "-";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

/** Tailwind colour for a return: green up, red down, muted when unknown. */
export function roiToneClass(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "text-muted-foreground";
  if (pct > 0) return "text-emerald-600 dark:text-emerald-400";
  if (pct < 0) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}
