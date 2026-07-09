"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import BalanceSheetCard from "./BalanceSheetCard";
import AccountingRollupView from "./AccountingRollupView";

// Business-level financial statements. These are all derived from the whole
// timeline (every trip's cash flow), so they live here rather than on a single
// trip's P&L tab. Home for the balance sheet, per-trip owner capital, and the
// monthly GL rollup.

interface TripCapital {
  trip_id: number;
  capital_invested_usd: number;
  cumulative_invested_usd: number;
}
interface TripLite {
  trip_id: number;
  name: string;
  started_at: string | null;
}

const usd = (n: number) =>
  `$${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FinancesView() {
  const { t } = useTranslation();
  const [caps, setCaps] = useState<TripCapital[]>([]);
  const [trips, setTrips] = useState<Map<number, TripLite>>(new Map());

  const fetchAll = useCallback(async () => {
    const supabase = createClient();
    const [{ data: capRows }, { data: tripRows }] = await Promise.all([
      supabase.rpc("get_trip_capital_invested"),
      supabase.from("trips").select("trip_id, name, started_at"),
    ]);
    setCaps((capRows as TripCapital[]) ?? []);
    const m = new Map<number, TripLite>();
    for (const tr of (tripRows as TripLite[]) ?? []) m.set(tr.trip_id, tr);
    setTrips(m);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Order the capital rows the way the RPC accumulates them: by trip start date.
  const rows = [...caps].sort((a, b) => {
    const sa = trips.get(a.trip_id)?.started_at ?? "";
    const sb = trips.get(b.trip_id)?.started_at ?? "";
    return sa === sb ? a.trip_id - b.trip_id : sa < sb ? -1 : 1;
  });
  const totalInvested = rows.reduce((s, r) => s + Number(r.capital_invested_usd), 0);

  return (
    <div className="space-y-6">
      <BalanceSheetCard />

      <Card size="sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t("finances.capitalTitle")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("finances.capitalNote")}</p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("finances.capitalTrip")}</TableHead>
                <TableHead className="text-right">{t("trips.capitalInvested")}</TableHead>
                <TableHead className="text-right">{t("trips.capitalCumulative")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.trip_id}>
                  <TableCell>{trips.get(r.trip_id)?.name ?? `Trip ${r.trip_id}`}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(Number(r.capital_invested_usd))}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{usd(Number(r.cumulative_invested_usd))}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={3} className="text-muted-foreground">{t("trips.empty")}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          {rows.length > 0 && (
            <p className="mt-2 text-sm font-medium">
              {t("finances.capitalTotal")}: {usd(totalInvested)}
            </p>
          )}
        </CardContent>
      </Card>

      <AccountingRollupView />
    </div>
  );
}
