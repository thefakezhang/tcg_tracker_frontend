"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { useTrips } from "./TripContext";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface OverviewRow {
  trip_id: number;
  name: string;
  status: string;
  export_revenue_usd: number;
  export_profit_usd: number;
  import_realized_margin_usd: number;
  expenses_usd: number;
  realized_net_usd: number;
  roi_pct: number | null;
}

// Global operating position — aggregated across the whole operation, not per
// trip (which the table below shows). Capital-in-inventory is the piece the
// per-trip P&L doesn't roll up; the rest reconciles realized margin vs expenses.
interface Position {
  invImport: number;
  invExport: number;
  invCost: number;
  margin: number;   // realized, non-reverted sales
  expenses: number; // trip + overhead
}

const usd = (n: number) => "$" + Math.round(n).toLocaleString();

async function fetchPosition(): Promise<Position> {
  const supabase = createClient();
  // Server-side aggregate (migration 000165). This used to select every row of
  // three views and sum them in the browser - but sales_ledger_v grows
  // unbounded, so once sales passed PostgREST's 1000-row cap the response was
  // silently truncated and the headline margin under-reported with no error.
  // The RPC returns one row, so the transfer is O(1) and truncation is
  // impossible; it also surfaces query errors instead of the old code's silent
  // `?? []` that turned a failed fetch into a $0 sum.
  const { data, error } = await supabase.rpc("trip_position").single();
  if (error) throw error;
  const r = data as {
    inv_import_usd: number; inv_export_usd: number; margin_usd: number; expenses_usd: number;
  };
  const invImport = Number(r.inv_import_usd ?? 0);
  const invExport = Number(r.inv_export_usd ?? 0);
  return {
    invImport, invExport, invCost: invImport + invExport,
    margin: Number(r.margin_usd ?? 0), expenses: Number(r.expenses_usd ?? 0),
  };
}

function Stat({ label, value, sub, valueClassName }: { label: string; value: string; sub?: string; valueClassName?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${valueClassName ?? ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function TripsOverview() {
  const { t } = useTranslation();
  const { setActiveTripId } = useTrips();
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [pos, setPos] = useState<Position | null>(null);

  const fetchRows = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("trips_overview_v")
      .select("trip_id, name, status, export_revenue_usd, export_profit_usd, import_realized_margin_usd, expenses_usd, realized_net_usd, roi_pct");
    setRows((data as OverviewRow[]) ?? []);
    setPos(await fetchPosition());
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">{t("trips.overviewTitle")}</h2>

      {pos && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label={t("trips.capitalInInventory")}
            value={usd(pos.invCost)}
            sub={`${t("trips.legImport")} ${usd(pos.invImport)} · ${t("trips.legExport")} ${usd(pos.invExport)}`}
          />
          <Stat label={t("trips.realizedMargin")} value={usd(pos.margin)} />
          <Stat label={t("trips.colExpenses")} value={usd(pos.expenses)} />
          <Stat
            label={t("trips.colNet")}
            value={usd(pos.margin - pos.expenses)}
            valueClassName={pos.margin - pos.expenses < 0 ? "text-destructive" : ""}
          />
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("trips.colTrip")}</TableHead>
            <TableHead>{t("trips.colStatus")}</TableHead>
            <TableHead className="text-right">{t("trips.colExportProfit")}</TableHead>
            <TableHead className="text-right">{t("trips.colImportMargin")}</TableHead>
            <TableHead className="text-right">{t("trips.colExpenses")}</TableHead>
            <TableHead className="text-right">{t("trips.colNet")}</TableHead>
            <TableHead className="text-right">{t("trips.colRoi")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.trip_id}
              className="cursor-pointer hover:bg-accent/50"
              onClick={() => setActiveTripId(r.trip_id)}
            >
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell>{r.status}</TableCell>
              <TableCell className="text-right">${r.export_profit_usd}</TableCell>
              <TableCell className="text-right">${r.import_realized_margin_usd}</TableCell>
              <TableCell className="text-right">${r.expenses_usd}</TableCell>
              <TableCell className={`text-right ${r.realized_net_usd < 0 ? "text-destructive" : ""}`}>
                ${r.realized_net_usd}
              </TableCell>
              <TableCell className="text-right">{r.roi_pct == null ? "—" : `${r.roi_pct}%`}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-muted-foreground">{t("trips.noTrips")}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
