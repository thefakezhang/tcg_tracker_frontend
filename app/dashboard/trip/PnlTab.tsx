"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AccountingRollupView from "../AccountingRollupView";

interface Pnl {
  export_revenue_usd: number;
  export_profit_usd: number;
  import_lot_cost_usd: number;
  import_realized_margin_usd: number;
  import_unrealized_cost_usd: number;
  expenses_usd: number;
  realized_net_usd: number;
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

  const fetchPnl = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_trip_pnl", { p_trip_id: tripId });
    if (!error && data && data.length > 0) setPnl(data[0] as Pnl);
  }, [tripId]);

  useEffect(() => { fetchPnl(); }, [fetchPnl]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-3 text-base font-semibold">{t("trips.pnlTitle")}</h2>
        {pnl && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label={t("trips.exportProfit")} value={pnl.export_profit_usd} />
            <Stat label={t("trips.importLotCost")} value={pnl.import_lot_cost_usd} />
            <Stat label={t("trips.importRealized")} value={pnl.import_realized_margin_usd} />
            <Stat label={t("trips.importUnrealized")} value={pnl.import_unrealized_cost_usd} />
            <Stat label={t("trips.expenses")} value={pnl.expenses_usd} />
            <Stat label={t("trips.netProfit")} value={pnl.realized_net_usd} />
          </div>
        )}
      </div>
      <AccountingRollupView />
    </div>
  );
}
