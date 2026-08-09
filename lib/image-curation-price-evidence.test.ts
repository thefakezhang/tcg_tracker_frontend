import { describe, expect, it } from "vitest";
import { isAutoApprovePriceEvidence } from "./image-curation-price-evidence";

describe("image curation price evidence", () => {
  it("keeps identity and OCR readability from substituting for semantic evidence", () => {
    expect(isAutoApprovePriceEvidence({
      verified: false,
      method: "recognition_fallback",
      ocr_confidence: 0.99,
      banner: null,
    })).toBe(false);
  });

  it("enforces the measured banner threshold even when verified is claimed", () => {
    expect(isAutoApprovePriceEvidence({
      verified: true,
      method: "banner_plain_digits",
      ocr_confidence: 0.99,
      banner: { kind: "yellow", score: 0.54, threshold: 0.55, matched: true },
    })).toBe(false);
    expect(isAutoApprovePriceEvidence({
      verified: true,
      method: "banner_plain_digits",
      ocr_confidence: 0.82,
      banner: { kind: "yellow", score: 0.72, threshold: 0.55, matched: true },
    })).toBe(true);
  });

  it("accepts explicit currency and grouped-number evidence", () => {
    expect(isAutoApprovePriceEvidence({
      verified: true,
      method: "currency_marker",
      ocr_confidence: 0.75,
      banner: null,
    })).toBe(true);
    expect(isAutoApprovePriceEvidence({
      verified: true,
      method: "grouped_number",
      ocr_confidence: 0.8,
      banner: null,
    })).toBe(true);
  });

  it("does not let a currency marker override a failed configured banner", () => {
    expect(isAutoApprovePriceEvidence({
      verified: true,
      method: "currency_marker",
      ocr_confidence: 0.99,
      banner: { kind: "yellow", score: 0.12, threshold: 0.55, matched: false },
    })).toBe(false);
  });

  it("does not trust a recorded threshold below the source-safe minimum", () => {
    expect(isAutoApprovePriceEvidence({
      verified: true,
      method: "banner_plain_digits",
      ocr_confidence: 0.99,
      banner: { kind: "yellow", score: 0.12, threshold: 0.01, matched: true },
    })).toBe(false);
  });
});
