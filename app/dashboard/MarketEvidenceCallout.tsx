"use client";

import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import type { MarketEvidence } from "./market-evidence";

function usd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function differencePercent(evidence: MarketEvidence): number {
  return Math.round(Math.abs(evidence.differencePct ?? 0) * 100);
}

export function MarketEvidenceBadge({
  evidence,
  className,
}: {
  evidence: MarketEvidence | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!evidence || (evidence.status !== "collectr_only" && evidence.status !== "discrepant")) {
    return null;
  }

  const label = evidence.status === "collectr_only"
    ? t("marketEvidence.collectrOnlyBadge")
    : evidence.differencePct! > 0
      ? t("marketEvidence.discrepancyAboveBadge", { percent: differencePercent(evidence) })
      : t("marketEvidence.discrepancyBelowBadge", { percent: differencePercent(evidence) });

  return (
    <Badge
      variant="outline"
      className={cn(
        "border-amber-500/60 bg-amber-500/10 text-amber-800 dark:text-amber-300",
        className,
      )}
    >
      <TriangleAlert aria-hidden="true" />
      {label}
    </Badge>
  );
}

export function MarketEvidenceCallout({
  evidence,
}: {
  evidence: MarketEvidence | null | undefined;
}) {
  const { t } = useTranslation();
  if (!evidence || evidence.collectrUsd == null) return null;
  if (evidence.status !== "collectr_only" && evidence.status !== "discrepant") return null;

  const isCollectrOnly = evidence.status === "collectr_only";
  const title = isCollectrOnly
    ? t("marketEvidence.collectrOnlyTitle")
    : t("marketEvidence.discrepancyTitle");
  const body = isCollectrOnly
    ? t("marketEvidence.collectrOnlyBody", { collectr: usd(evidence.collectrUsd) })
    : evidence.differencePct! > 0
      ? t("marketEvidence.discrepancyAboveBody", {
          collectr: usd(evidence.collectrUsd),
          tcgplayer: usd(evidence.tcgplayerUsd!),
          percent: differencePercent(evidence),
        })
      : t("marketEvidence.discrepancyBelowBody", {
          collectr: usd(evidence.collectrUsd),
          tcgplayer: usd(evidence.tcgplayerUsd!),
          percent: differencePercent(evidence),
        });

  return (
    <section
      aria-label={t("marketEvidence.label")}
      className="mb-3 flex gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <div className="min-w-0">
        <div className="font-medium text-amber-900 dark:text-amber-200">{title}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </section>
  );
}
