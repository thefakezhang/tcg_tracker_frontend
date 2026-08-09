export interface PriceBannerEvidence {
  kind: string;
  score: number;
  threshold: number;
  matched: boolean;
}

export interface PriceEvidence {
  verified: boolean;
  method: string;
  ocr_confidence: number | null;
  banner: PriceBannerEvidence | null;
}

const DIRECT_METHODS = new Set(["currency_marker", "grouped_number"]);
const BANNER_METHODS = new Set([
  "banner_plain_digits",
  "currency_alias",
  "recognition_fallback",
]);
const MINIMUM_BANNER_THRESHOLDS: Record<string, number> = {
  white: 0.40,
  yellow: 0.55,
  red: 0.55,
  black: 0.50,
};

export function isAutoApprovePriceEvidence(
  evidence: PriceEvidence | null | undefined,
): boolean {
  if (!evidence || evidence.verified !== true) return false;
  if (evidence.banner) {
    const minimumThreshold = MINIMUM_BANNER_THRESHOLDS[evidence.banner.kind];
    return (DIRECT_METHODS.has(evidence.method) || BANNER_METHODS.has(evidence.method))
      && evidence.banner.matched === true
      && minimumThreshold != null
      && Number.isFinite(evidence.banner.score)
      && Number.isFinite(evidence.banner.threshold)
      && evidence.banner.score >= 0
      && evidence.banner.score <= 1
      && evidence.banner.threshold >= minimumThreshold
      && evidence.banner.threshold <= 1
      && evidence.banner.score >= evidence.banner.threshold;
  }
  return DIRECT_METHODS.has(evidence.method);
}

export function evidencePercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100);
}
