"use client";

// Business health: the standing "how is my business doing" answer, read from
// the business_*_v views (backend migration 000352) so the dashboard shows
// the same numbers as any ad-hoc analysis: cancelled sales fully excluded,
// all three sale tables counted, reconciliation exits separated.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface CashPosition {
  purchases_usd: number;
  trip_expenses_usd: number;
  pokemon_sales_net_usd: number;
  sealed_sales_net_usd: number;
  mtg_sales_net_usd: number;
  realized_margin_usd: number;
  inventory_at_cost_usd: number;
}
interface MonthRow {
  period_month: string;
  cash_out_usd: number;
  cash_in_usd: number;
  cumulative_position_usd: number;
}
interface SegmentRow {
  trip_id: number | null;
  trip_name: string | null;
  leg: string;
  game: string;
  segment: string;
  units: number;
  units_sold: number;
  landed_cost_usd: number;
  net_proceeds_usd: number;
  cogs_usd: number;
  realized_profit_usd: number;
  on_hand_cost_usd: number;
}
interface VelocityRow {
  trip_name: string | null;
  leg: string;
  segment: string;
  sold_layers: number;
  median_days_to_sale: number | null;
  p90_days_to_sale: number | null;
  reconciliation_units: number;
}
interface AgingRow {
  age_bucket: string;
  game: string;
  segment: string;
  units: number;
  on_hand_cost_usd: number;
  theoretical_profit_usd: number | null;
  below_cost_lines: number;
  unpriced_lines: number;
  median_days_held: number | null;
}

const usd = (n: number | null | undefined) =>
  n == null ? "-" : `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (num: number, den: number) =>
  den > 0 ? `${((100 * num) / den).toFixed(1)}%` : "-";
const days = (n: number | null) => (n == null ? "-" : `${Math.round(n)}d`);

export default function BusinessHealthSection() {
  const { t } = useTranslation();
  const [position, setPosition] = useState<CashPosition | null>(null);
  const [months, setMonths] = useState<MonthRow[]>([]);
  const [segments, setSegments] = useState<SegmentRow[]>([]);
  const [velocity, setVelocity] = useState<VelocityRow[]>([]);
  const [aging, setAging] = useState<AgingRow[]>([]);

  const fetchAll = useCallback(async () => {
    const supabase = createClient();
    const [pos, mon, seg, vel, age] = await Promise.all([
      supabase.from("business_cash_position_v").select("*").single(),
      supabase.from("business_monthly_cashflow_v").select("*").order("period_month"),
      supabase.from("business_segment_economics_v").select("*").order("trip_id", { ascending: true, nullsFirst: false }),
      supabase.from("business_velocity_v").select("*").order("trip_id", { ascending: true, nullsFirst: false }),
      supabase.from("business_inventory_aging_v").select("*").order("age_bucket"),
    ]);
    setPosition((pos.data as CashPosition | null) ?? null);
    setMonths((mon.data as MonthRow[]) ?? []);
    setSegments((seg.data as SegmentRow[]) ?? []);
    setVelocity((vel.data as VelocityRow[]) ?? []);
    setAging((age.data as AgingRow[]) ?? []);
  }, []);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const salesNet = position
    ? position.pokemon_sales_net_usd + position.sealed_sales_net_usd + position.mtg_sales_net_usd
    : 0;
  const deployed = position ? position.purchases_usd + position.trip_expenses_usd - salesNet : 0;

  return (
    <div className="space-y-4">
      {/* Headline cards */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">{t("finances.healthDeployed")}</CardTitle></CardHeader>
          <CardContent className="text-xl font-semibold tabular-nums">{usd(deployed)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">{t("finances.healthInventory")}</CardTitle></CardHeader>
          <CardContent className="text-xl font-semibold tabular-nums">{usd(position?.inventory_at_cost_usd)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">{t("finances.healthRealized")}</CardTitle></CardHeader>
          <CardContent className="text-xl font-semibold tabular-nums">{usd(position?.realized_margin_usd)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">{t("finances.healthSalesNet")}</CardTitle></CardHeader>
          <CardContent className="text-xl font-semibold tabular-nums">{usd(salesNet)}
            <div className="mt-1 text-xs font-normal text-muted-foreground">
              {t("finances.healthSalesSplit", {
                pokemon: usd(position?.pokemon_sales_net_usd),
                sealed: usd(position?.sealed_sales_net_usd),
                mtg: usd(position?.mtg_sales_net_usd),
              })}
            </div>
          </CardContent>
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">{t("finances.healthDeployedNote")}</p>

      {/* Monthly cashflow */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t("finances.healthCashflowTitle")}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("finances.healthMonth")}</TableHead>
              <TableHead className="text-right">{t("finances.healthCashOut")}</TableHead>
              <TableHead className="text-right">{t("finances.healthCashIn")}</TableHead>
              <TableHead className="text-right">{t("finances.healthCumulative")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {months.map((m) => (
                <TableRow key={m.period_month}>
                  <TableCell className="text-xs">{String(m.period_month).slice(0, 7)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(m.cash_out_usd)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(m.cash_in_usd)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${m.cumulative_position_usd < 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                    {usd(m.cumulative_position_usd)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-1 text-xs text-muted-foreground">{t("finances.healthCumulativeNote")}</p>
        </CardContent>
      </Card>

      {/* Segment economics */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t("finances.healthSegmentsTitle")}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("finances.healthTrip")}</TableHead>
              <TableHead>{t("finances.healthLeg")}</TableHead>
              <TableHead>{t("finances.healthSegment")}</TableHead>
              <TableHead className="text-right">{t("finances.healthSold")}</TableHead>
              <TableHead className="text-right">{t("finances.healthLanded")}</TableHead>
              <TableHead className="text-right">{t("finances.healthProfit")}</TableHead>
              <TableHead className="text-right">{t("finances.healthRoc")}</TableHead>
              <TableHead className="text-right">{t("finances.healthOnHand")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {segments.map((s, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{s.trip_name ?? t("finances.healthNoTrip")}</TableCell>
                  <TableCell className="text-xs">{s.leg}</TableCell>
                  <TableCell className="text-xs">{s.game === "pokemon" ? s.segment : `${s.game} ${s.segment}`}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{s.units_sold}/{s.units}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{usd(s.landed_cost_usd)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{usd(s.realized_profit_usd)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{pct(s.realized_profit_usd, s.cogs_usd)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{usd(s.on_hand_cost_usd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Velocity */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t("finances.healthVelocityTitle")}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("finances.healthTrip")}</TableHead>
              <TableHead>{t("finances.healthLeg")}</TableHead>
              <TableHead>{t("finances.healthSegment")}</TableHead>
              <TableHead className="text-right">{t("finances.healthSoldLayers")}</TableHead>
              <TableHead className="text-right">{t("finances.healthMedianDays")}</TableHead>
              <TableHead className="text-right">{t("finances.healthP90Days")}</TableHead>
              <TableHead className="text-right">{t("finances.healthReconUnits")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {velocity.map((v, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{v.trip_name ?? t("finances.healthNoTrip")}</TableCell>
                  <TableCell className="text-xs">{v.leg}</TableCell>
                  <TableCell className="text-xs">{v.segment}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{v.sold_layers}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{days(v.median_days_to_sale)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{days(v.p90_days_to_sale)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{v.reconciliation_units}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-1 text-xs text-muted-foreground">{t("finances.healthReconNote")}</p>
        </CardContent>
      </Card>

      {/* Inventory aging */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t("finances.healthAgingTitle")}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t("finances.healthAgeBucket")}</TableHead>
              <TableHead>{t("finances.healthSegment")}</TableHead>
              <TableHead className="text-right">{t("finances.healthUnits")}</TableHead>
              <TableHead className="text-right">{t("finances.healthOnHand")}</TableHead>
              <TableHead className="text-right">{t("finances.healthTheoProfit")}</TableHead>
              <TableHead className="text-right">{t("finances.healthUnpriced")}</TableHead>
              <TableHead className="text-right">{t("finances.healthMedianHeld")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {aging.map((a, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{a.age_bucket}</TableCell>
                  <TableCell className="text-xs">{a.game === "pokemon" ? a.segment : `${a.game} ${a.segment}`}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{a.units}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{usd(a.on_hand_cost_usd)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{usd(a.theoretical_profit_usd)}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{a.unpriced_lines}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{days(a.median_days_held)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-1 text-xs text-muted-foreground">{t("finances.healthAgingNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
