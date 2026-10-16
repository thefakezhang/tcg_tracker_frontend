import { describe, expect, it } from "vitest";
import { spreadRatio, toCompSpread } from "./CompSpreadBar";

// The bar exists to distinguish a median twelve comps agreed on from one three
// comps disagreed about. Every way of ending up with no usable band has to
// return null rather than a bar drawn around nothing, because a half-drawn
// spread would be read as evidence.
describe("toCompSpread", () => {
  it("builds a band when all three figures are present", () => {
    expect(toCompSpread(148, 120, 180)).toEqual({ median: 148, p25: 120, p75: 180 });
  });

  it.each([
    ["no median", null, 120, 180],
    ["no p25", 148, null, 180],
    ["no p75", 148, 120, null],
    ["nothing at all", null, null, null],
  ])("returns null with %s", (_label, median, p25, p75) => {
    expect(toCompSpread(median, p25, p75)).toBeNull();
  });

  it("treats undefined the same as null, since optional fields arrive that way", () => {
    expect(toCompSpread(148, undefined, undefined)).toBeNull();
  });

  // The database CHECK rejects an inverted pair, so reaching this means a
  // hand-built fixture. Drawing it backwards would put the marker outside the
  // bar, which reads as a rendering bug rather than bad data.
  it("refuses an inverted band rather than drawing it backwards", () => {
    expect(toCompSpread(148, 180, 120)).toBeNull();
  });

  it("accepts a zero-width band, which is every comp agreeing exactly", () => {
    expect(toCompSpread(20, 20, 20)).toEqual({ median: 20, p25: 20, p75: 20 });
  });

  it("rejects non-finite figures", () => {
    expect(toCompSpread(Number.NaN, 120, 180)).toBeNull();
    expect(toCompSpread(148, Number.NEGATIVE_INFINITY, 180)).toBeNull();
  });
});

describe("spreadRatio", () => {
  it("is zero when every comp agreed", () => {
    expect(spreadRatio({ median: 20, p25: 20, p75: 20 })).toBe(0);
  });

  it("measures the band against its own centre, so it is scale free", () => {
    // Both are quartiles half a median apart; a $10 card and a $10,000 card
    // with equally noisy comps must sort together.
    expect(spreadRatio({ median: 100, p25: 75, p75: 125 })).toBeCloseTo(0.5);
    expect(spreadRatio({ median: 10000, p25: 7500, p75: 12500 })).toBeCloseTo(0.5);
  });

  // 274/XY-P: the conflated printing sat at exactly 20 while the real card
  // fetched 1,780-2,500, which is the shape the dispersion filter was built
  // for. A band that wide must rank above ordinary noise.
  it("ranks a badly conflated card above an ordinary one", () => {
    const conflated = spreadRatio({ median: 100, p25: 20, p75: 2000 });
    const ordinary = spreadRatio({ median: 100, p25: 90, p75: 110 });
    expect(conflated).toBeGreaterThan(ordinary);
  });

  it("does not divide by zero when the median is zero", () => {
    expect(Number.isFinite(spreadRatio({ median: 0, p25: 1, p75: 3 }))).toBe(true);
  });
});
