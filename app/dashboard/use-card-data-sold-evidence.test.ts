import { describe, expect, it, vi } from "vitest";
import { applySoldEvidenceQuery } from "./use-card-data";

describe("use-card-data sold-evidence query builder", () => {
  it("does not touch the query when the filter is off", () => {
    const builder = { eq: vi.fn() };
    builder.eq.mockReturnValue(builder);

    expect(applySoldEvidenceQuery(builder, false)).toBe(builder);
    expect(builder.eq).not.toHaveBeenCalled();
  });

  it("constrains the EXIT leg's kind, not the entry leg or a source name", () => {
    // best_sell is what we pay; best_buy is what we realize. Gating the wrong
    // leg would filter on the cost side and quietly change what ROI means.
    const builder = { eq: vi.fn() };
    builder.eq.mockReturnValue(builder);

    expect(applySoldEvidenceQuery(builder, true)).toBe(builder);
    expect(builder.eq.mock.calls).toEqual([["best_buy_kind", "sold"]]);
  });

  it("excludes valuation exits, which is what Collectr and PriceCharting are", () => {
    // Keyed on the kind rather than a source list so a new valuation feed is
    // excluded the day it lands.
    const builder = { eq: vi.fn() };
    builder.eq.mockReturnValue(builder);
    applySoldEvidenceQuery(builder, true);

    const [[column, value]] = builder.eq.mock.calls;
    expect(column).toBe("best_buy_kind");
    expect(value).toBe("sold");
    expect(value).not.toBe("valuation");
  });
});
