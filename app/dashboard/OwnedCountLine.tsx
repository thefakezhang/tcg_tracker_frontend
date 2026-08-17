"use client";

import { Eye } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { CardObservation } from "./card-observations";

import { formatUsd } from "@/lib/money";
// The one-line owned signal rendered on browse tiles and list rows.
// Owned = finalized on-hand copies; incoming = copies on a draft acquisition
// lot (recorded mid-trip, not yet finalized) - shown distinctly so "0 owned
// +2 in draft lot" never reads as "you have none".
export function OwnedCountLine({
  owned,
  incoming,
  avgCost,
  totalCost,
  consigned,
  availableOnly,
}: {
  owned?: number;
  incoming?: number;
  avgCost?: number | null;
  totalCost?: number | null;
  consigned?: number;
  // When true, tally the copies you can actually sell (owned - consigned).
  availableOnly?: boolean;
}) {
  const { t } = useTranslation();
  const ownedQty = owned ?? 0;
  const incomingQty = incoming ?? 0;
  const consignedQty = consigned ?? 0;
  const availableQty = Math.max(0, ownedQty - consignedQty);
  if (ownedQty <= 0 && incomingQty <= 0) return null;
  return (
    <div className="text-[11px] text-muted-foreground">
      {ownedQty > 0 && availableOnly && (
        <span>{t("inventory.available")} {availableQty}</span>
      )}
      {ownedQty > 0 && !availableOnly && (
        <span>
          {t("inventory.owned")} {ownedQty}
          {consignedQty > 0 && <span className="text-violet-500/90"> · {t("inventory.consignedN", { n: consignedQty })}</span>}
        </span>
      )}
      {/* Landed cost of the owned copies: labelled once, per-copy avg + total. */}
      {ownedQty > 0 && avgCost != null && (
        <span> · {t("inventory.landedCostLabel")} {formatUsd(avgCost)}{t("inventory.perUnitAbbr")}{totalCost != null ? ` · ${formatUsd(totalCost)} ${t("inventory.total")}` : ""}</span>
      )}
      {incomingQty > 0 && (
        <span className="text-amber-500/90">
          {ownedQty > 0 ? " " : ""}{t("inventory.incoming", { n: incomingQty })}
        </span>
      )}
    </div>
  );
}

// The operator's own observations for a card, shown while browsing so logged
// listings surface on the normal page: count + cheapest observed price.
export function ObservedLine({ observed }: { observed?: CardObservation }) {
  const { t } = useTranslation();
  if (!observed || observed.count <= 0) return null;
  const sym = observed.cheapestCurrency === "JPY" ? "¥" : observed.cheapestCurrency === "USD" ? "$" : "";
  const orig = observed.cheapestOrig != null ? `${sym}${observed.cheapestOrig.toLocaleString()}` : "";
  const usd = observed.cheapestCurrency !== "USD" && observed.cheapestUsd != null ? ` (${formatUsd(observed.cheapestUsd)})` : "";
  return (
    <div className="text-[11px] text-sky-600 dark:text-sky-400">
      <Eye className="mr-0.5 inline size-3 align-[-1px]" />
      {t("inventory.observed")} {observed.count}{orig ? ` · ${orig}${usd}` : ""}
    </div>
  );
}
