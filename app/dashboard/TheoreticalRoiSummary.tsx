"use client";

import { TrendingUp, AlertTriangle } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { formatRoiPct, roiToneClass, type RoiSummary } from "./theoretical-roi";

// One rollup, rendered the same way wherever it appears - the leg strip, the lot
// header, or a filtered inventory total - so a figure the operator recognises at
// one grain reads identically at the next.
//
// It always states its own coverage. A rollup where some lines have no exit
// quote is honest only if it says so, and the export leg has NO priced lines at
// all (see theoretical-roi.ts), where the correct answer is "not valued", never
// "0%".
export default function TheoreticalRoiSummary({
  summary,
  label,
  compact = false,
}: {
  summary: RoiSummary | null;
  /** Heading for this grain, e.g. "Import leg" or the shop name. */
  label?: string;
  /** Inline single-line form, for a place that already has a header. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  if (!summary || summary.lines === 0) return null;

  const nothingPriced = summary.priced === 0;
  const body = nothingPriced ? (
    <span className="text-muted-foreground">{t("roi.notValued")}</span>
  ) : (
    <>
      {/* The headline number is NET, not the market price. Say so, and say the
          rate it was netted at - a bare dollar figure here reads as market. */}
      <span className="font-medium tabular-nums">
        ${summary.netUsd.toFixed(2)}
      </span>{" "}
      <span className="text-muted-foreground">
        {summary.netPct != null
          ? t("roi.netOfAt", {
              pct: Math.round(summary.netPct * 100),
              gross: summary.grossUsd.toFixed(2),
              cost: summary.pricedCostUsd.toFixed(2),
            })
          : t("roi.netOf", { cost: summary.pricedCostUsd.toFixed(2) })}
      </span>
      {" · "}
      <span className={`font-medium tabular-nums ${roiToneClass(summary.roiPct)}`}>
        {summary.profitUsd >= 0 ? "+" : "-"}${Math.abs(summary.profitUsd).toFixed(2)}
        {" "}({formatRoiPct(summary.roiPct)})
      </span>
      {summary.unpriced > 0 && (
        <>
          {" · "}
          <span className="text-muted-foreground">
            {t("roi.coverage", { priced: summary.priced, total: summary.lines })}
          </span>
        </>
      )}
      {summary.belowCost > 0 && (
        <>
          {" · "}
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3" />
            {t("roi.belowCostN", { n: summary.belowCost })}
          </span>
        </>
      )}
    </>
  );

  if (compact) {
    return (
      <span className="text-xs">
        <span className="text-muted-foreground">{t("roi.theoretical")}: </span>
        {body}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-accent/30 px-3 py-2 text-xs">
      <TrendingUp className="size-4 shrink-0 text-muted-foreground" />
      <span className="font-medium">{label ?? t("roi.theoretical")}</span>
      <span className="text-muted-foreground">·</span>
      {body}
    </div>
  );
}
