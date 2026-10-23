import { describe, expect, it, vi } from "vitest";
import { applyMeasuredExitQuery } from "./use-card-data";

describe("use-card-data measured-exit query builder", () => {
  it("does not touch the query when the filter is off", () => {
    const builder = { in: vi.fn() };
    builder.in.mockReturnValue(builder);

    expect(applyMeasuredExitQuery(builder, false)).toBe(builder);
    expect(builder.in).not.toHaveBeenCalled();
  });

  it("constrains the EXIT leg's evidence, not the entry leg", () => {
    // best_sell is what we pay; best_buy is what we realize. Gating the wrong
    // leg would filter on the cost side and quietly change what ROI means.
    const builder = { in: vi.fn() };
    builder.in.mockReturnValue(builder);

    expect(applyMeasuredExitQuery(builder, true)).toBe(builder);
    const [[column]] = builder.in.mock.calls;
    expect(column).toBe("best_buy_evidence");
  });

  it("admits a committed bid and a measured sale, and nothing else", () => {
    const builder = { in: vi.fn() };
    builder.in.mockReturnValue(builder);
    applyMeasuredExitQuery(builder, true);

    const [[, values]] = builder.in.mock.calls;
    expect([...values].sort()).toEqual(["bid", "sale_measured"]);
  });

  it("excludes the unmeasured sale, which is the whole point", () => {
    // 78,279 of 321,281 exits are a completed sale with nothing showing the
    // printing still trades. The weaker applySoldEvidenceQuery admits every
    // one of them, because it keys on the kind.
    const builder = { in: vi.fn() };
    builder.in.mockReturnValue(builder);
    applyMeasuredExitQuery(builder, true);

    const [[, values]] = builder.in.mock.calls;
    expect(values).not.toContain("sale_unmeasured");
    expect(values).not.toContain("estimate");
    expect(values).not.toContain("unclassified");
  });

  it("filters server-side with one call, so it composes with pagination", () => {
    // A client-side screen would interact with the PostgREST row cap: the page
    // would be filtered after truncation and the count would disagree with it.
    const builder = { in: vi.fn() };
    builder.in.mockReturnValue(builder);
    applyMeasuredExitQuery(builder, true);

    expect(builder.in).toHaveBeenCalledTimes(1);
  });
});
