"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Pnl {
  import_lot_cost_usd: number;
  import_realized_margin_usd: number;
  import_unrealized_cost_usd: number;
  export_lot_cost_usd: number;
  export_realized_margin_usd: number;
  export_unrealized_cost_usd: number;
  expenses_usd: number;
  realized_net_usd: number;
  net_cash_usd: number;
}
interface TripCapital {
  trip_id: number;
  capital_invested_usd: number;
  cumulative_invested_usd: number;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card size="sm">
      <CardHeader className="pb-1"><CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent className={`text-lg font-semibold ${value < 0 ? "text-destructive" : ""}`}>
        ${value?.toFixed?.(2) ?? value}
      </CardContent>
    </Card>
  );
}

export default function PnlTab({ tripId }: { tripId: number }) {
  const { t } = useTranslation();
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [capital, setCapital] = useState<TripCapital | null>(null);

  const fetchPnl = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_trip_pnl", { p_trip_id: tripId });
    if (!error && data && data.length > 0) setPnl(data[0] as Pnl);
    // Per-trip owner capital injected (needs the whole timeline, so it comes back
    // for every trip; pick this one).
    const { data: caps } = await supabase.rpc("get_trip_capital_invested");
    if (caps) setCapital((caps as TripCapital[]).find((c) => c.trip_id === tripId) ?? null);
  }, [tripId]);

  useEffect(() => { fetchPnl(); }, [fetchPnl]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 text-base font-semibold">{t("trips.pnlTitle")}</h2>
        {pnl && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t("trips.importCost")} value={pnl.import_lot_cost_usd} />
            <Stat label={t("trips.importMargin")} value={pnl.import_realized_margin_usd} />
            <Stat label={t("trips.importUnsold")} value={pnl.import_unrealized_cost_usd} />
            <Stat label={t("trips.expenses")} value={pnl.expenses_usd} />
            <Stat label={t("trips.exportCost")} value={pnl.export_lot_cost_usd} />
            <Stat label={t("trips.exportMargin")} value={pnl.export_realized_margin_usd} />
            <Stat label={t("trips.exportUnsold")} value={pnl.export_unrealized_cost_usd} />
            <Stat label={t("trips.netProfit")} value={pnl.realized_net_usd} />
          </div>
        )}
        {(capital || pnl) && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {capital && <Stat label={t("trips.capitalInvested")} value={capital.capital_invested_usd} />}
            {pnl && <Stat label={t("trips.netCash")} value={pnl.net_cash_usd} />}
          </div>
        )}
        {(capital || pnl) && (
          <p className="mt-2 text-xs text-muted-foreground">{t("trips.capitalHint")}</p>
        )}
      </div>
    </div>
  );
}
