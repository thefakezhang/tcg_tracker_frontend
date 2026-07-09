"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Business-wide balance sheet (get_balance_sheet RPC). Derived from trip/lot/sale
// data: Assets (cash + inventory at cost) = Liabilities (0) + Equity (contributed
// capital + retained earnings + a reconciliation line for subledger rounding).
interface BalanceSheet {
  cash_usd: number;
  inventory_at_cost_usd: number;
  total_assets_usd: number;
  liabilities_usd: number;
  contributed_capital_usd: number;
  retained_earnings_usd: number;
  reconciliation_usd: number;
  total_equity_usd: number;
}

const usd = (n: number) =>
  `$${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Row({ label, value, bold, muted }: { label: string; value: number; bold?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "mt-0.5 border-t pt-1 font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className={`tabular-nums ${value < 0 ? "text-destructive" : ""}`}>{usd(value)}</span>
    </div>
  );
}

export default function BalanceSheetCard() {
  const { t } = useTranslation();
  const [bs, setBs] = useState<BalanceSheet | null>(null);

  useEffect(() => {
    createClient()
      .rpc("get_balance_sheet")
      .then(({ data }) => {
        if (data && data.length) setBs(data[0] as BalanceSheet);
      });
  }, []);

  if (!bs) return null;
  // Only surface the reconciliation line when it's non-trivial; a few cents of
  // rounding shouldn't clutter the statement.
  const reconMaterial = Math.abs(bs.reconciliation_usd) >= 1;

  return (
    <Card size="sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{t("balanceSheet.title")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("balanceSheet.assets")}</div>
          <Row label={t("balanceSheet.cash")} value={bs.cash_usd} />
          <Row label={t("balanceSheet.inventory")} value={bs.inventory_at_cost_usd} />
          <Row label={t("balanceSheet.totalAssets")} value={bs.total_assets_usd} bold />
        </div>
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("balanceSheet.liabEquity")}</div>
          <Row label={t("balanceSheet.liabilities")} value={bs.liabilities_usd} muted />
          <Row label={t("balanceSheet.contributed")} value={bs.contributed_capital_usd} />
          <Row label={t("balanceSheet.retained")} value={bs.retained_earnings_usd} />
          {reconMaterial && <Row label={t("balanceSheet.reconciliation")} value={bs.reconciliation_usd} muted />}
          <Row label={t("balanceSheet.totalEquity")} value={bs.total_equity_usd} bold />
        </div>
      </CardContent>
    </Card>
  );
}
