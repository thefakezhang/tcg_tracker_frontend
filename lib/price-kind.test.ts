import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import {
  PRICE_KINDS,
  isPriceKind,
  priceKindMarkerKey,
  priceKindTitleKey,
} from "./price-kind";

describe("price kind markers", () => {
  it("labels a sale, an offer and an estimate, and nothing else", () => {
    expect(priceKindMarkerKey("sold")).toBe("priceKind.sold");
    expect(priceKindMarkerKey("bid")).toBe("priceKind.bid");
    expect(priceKindMarkerKey("valuation")).toBe("priceKind.valuation");
    // An ask is the acquisition side; it never needs qualifying.
    expect(priceKindMarkerKey("ask")).toBeNull();
    expect(priceKindMarkerKey(null)).toBeNull();
    expect(priceKindMarkerKey(undefined)).toBeNull();
  });

  it("has a tooltip for every marker and none where there is no marker", () => {
    for (const kind of PRICE_KINDS) {
      const marker = priceKindMarkerKey(kind);
      const title = priceKindTitleKey(kind);
      expect(marker === null).toBe(title === null);
    }
  });

  it("resolves every marker and tooltip key in both languages", () => {
    for (const kind of PRICE_KINDS) {
      for (const key of [priceKindMarkerKey(kind), priceKindTitleKey(kind)]) {
        if (key === null) continue;
        for (const language of ["en", "ja"] as const) {
          const text = t(language, key);
          expect(text).not.toBe(key);
          expect(text.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("recognises exactly the backend enum values", () => {
    for (const kind of PRICE_KINDS) expect(isPriceKind(kind)).toBe(true);
    expect(isPriceKind("offer")).toBe(false);
    expect(isPriceKind("")).toBe(false);
    expect(isPriceKind(null)).toBe(false);
    expect(isPriceKind(3)).toBe(false);
  });
});
