"use client";

import { useTranslation } from "@/lib/i18n";

// The one-line owned signal rendered on browse tiles and list rows.
// Owned = finalized on-hand copies; incoming = copies on a draft acquisition
// lot (recorded mid-trip, not yet finalized) - shown distinctly so "0 owned
// +2 in draft lot" never reads as "you have none".
export function OwnedCountLine({
  owned,
  incoming,
  avgCost,
  totalCost,
}: {
  owned?: number;
  incoming?: number;
  avgCost?: number | null;
  totalCost?: number | null;
}) {
  const { t } = useTranslation();
  const ownedQty = owned ?? 0;
  const incomingQty = incoming ?? 0;
  if (ownedQty <= 0 && incomingQty <= 0) return null;
  return (
    <div className="text-[11px] text-muted-foreground">
      {ownedQty > 0 && (
        <span>{t("inventory.owned")} {ownedQty}</span>
      )}
      {/* Landed cost of the owned copies: per-copy average + total. */}
      {ownedQty > 0 && avgCost != null && (
        <span> · {t("inventory.landedEach", { usd: avgCost.toFixed(2) })}</span>
      )}
      {ownedQty > 0 && totalCost != null && (
        <span> · {t("inventory.landedTotal", { usd: totalCost.toFixed(2) })}</span>
      )}
      {incomingQty > 0 && (
        <span className="text-amber-500/90">
          {ownedQty > 0 ? " " : ""}{t("inventory.incoming", { n: incomingQty })}
        </span>
      )}
    </div>
  );
}
