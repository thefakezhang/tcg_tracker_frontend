"use client";

import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface RollupRow {
  period_month: string;
  revenue_usd: number;
  cogs_usd: number;
  fees_usd: number;
  expenses_usd: number;
  net_usd: number;
}

export default function AccountingRollupView() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<RollupRow[]>([]);

  const fetchRows = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("accounting_rollup_v")
      .select("period_month, revenue_usd, cogs_usd, fees_usd, expenses_usd, net_usd")
      .order("period_month", { ascending: false });
    setRows((data as RollupRow[]) ?? []);
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  function exportCsv() {
    const header = "period_month,revenue_usd,cogs_usd,fees_usd,expenses_usd,net_usd";
    const lines = rows.map((r) =>
      [r.period_month, r.revenue_usd, r.cogs_usd, r.fees_usd, r.expenses_usd, r.net_usd].join(",")
    );
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "accounting_rollup.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("trips.rollupTitle")}</h3>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="size-4 mr-1" />{t("trips.exportCsv")}
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("trips.month")}</TableHead>
            <TableHead className="text-right">{t("trips.revenue")}</TableHead>
            <TableHead className="text-right">{t("trips.cogs")}</TableHead>
            <TableHead className="text-right">{t("trips.fees")}</TableHead>
            <TableHead className="text-right">{t("trips.expenses")}</TableHead>
            <TableHead className="text-right">{t("trips.net")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.period_month}>
              <TableCell>{r.period_month.slice(0, 7)}</TableCell>
              <TableCell className="text-right">${r.revenue_usd}</TableCell>
              <TableCell className="text-right">${r.cogs_usd}</TableCell>
              <TableCell className="text-right">${r.fees_usd}</TableCell>
              <TableCell className="text-right">${r.expenses_usd}</TableCell>
              <TableCell className={`text-right ${r.net_usd < 0 ? "text-destructive" : ""}`}>${r.net_usd}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={6} className="text-muted-foreground">{t("trips.empty")}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
