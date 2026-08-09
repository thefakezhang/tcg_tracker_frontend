"use client";

import { BadgeCheck, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/lib/i18n";
import {
  evidencePercent,
  isAutoApprovePriceEvidence,
  type PriceEvidence,
} from "@/lib/image-curation-price-evidence";

const METHOD_KEYS = {
  currency_marker: "curation.priceEvidence.method.currencyMarker",
  grouped_number: "curation.priceEvidence.method.groupedNumber",
  banner_plain_digits: "curation.priceEvidence.method.bannerDigits",
  currency_alias: "curation.priceEvidence.method.currencyAlias",
  recognition_fallback: "curation.priceEvidence.method.ocrFallback",
} as const;

export function PriceEvidenceBadge({ evidence }: { evidence: PriceEvidence | null }) {
  const { t } = useTranslation();
  const verified = isAutoApprovePriceEvidence(evidence);
  const bannerScore = evidencePercent(evidence?.banner?.score);
  const bannerThreshold = evidencePercent(evidence?.banner?.threshold);
  const ocr = evidencePercent(evidence?.ocr_confidence);
  const methodKey = evidence?.method
    ? METHOD_KEYS[evidence.method as keyof typeof METHOD_KEYS]
    : undefined;
  const method = methodKey ? t(methodKey) : t("curation.priceEvidence.method.unclassified");
  const ocrText = ocr == null ? t("evidence.unknown") : `${ocr}%`;

  let label = verified
    ? t("curation.priceEvidence.verifiedMethod", { method })
    : t("curation.priceEvidence.review");
  let detail = t("curation.priceEvidence.legacyHint");
  if (evidence?.banner && bannerScore != null && bannerThreshold != null) {
    label = verified
      ? t("curation.priceEvidence.verifiedBanner", { score: bannerScore })
      : t("curation.priceEvidence.reviewBanner", {
        score: bannerScore,
        threshold: bannerThreshold,
      });
    detail = t("curation.priceEvidence.bannerHint", {
      kind: evidence.banner.kind,
      score: bannerScore,
      threshold: bannerThreshold,
      ocr: ocrText,
    });
  } else if (evidence) {
    detail = t("curation.priceEvidence.methodHint", {
      method,
      ocr: ocrText,
    });
  }

  return (
    <Badge
      variant="outline"
      aria-label={detail}
      title={detail}
      className={verified
        ? "max-w-full gap-1 whitespace-normal break-words border-green-500/50 bg-green-500/10 text-left text-[10px] text-green-700 dark:text-green-400"
        : "max-w-full gap-1 whitespace-normal break-words border-amber-500/50 bg-amber-500/10 text-left text-[10px] text-amber-700 dark:text-amber-400"}
    >
      {verified
        ? <BadgeCheck aria-hidden="true" className="size-3" />
        : <TriangleAlert aria-hidden="true" className="size-3" />}
      {label}
    </Badge>
  );
}
