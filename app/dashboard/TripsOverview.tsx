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

export default function TripsOverview() {
  const { t } = useTranslation();
  const { setActiveTripId } = useTrips();
  const [rows, setRows] = useState<OverviewRow[]>([]);

  const fetchRows = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("trips_overview_v")
      .select("trip_id, name, status, export_revenue_usd, export_profit_usd, import_realized_margin_usd, expenses_usd, realized_net_usd, roi_pct");
    setRows((data as OverviewRow[]) ?? []);
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">{t("trips.overviewTitle")}</h2>
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
