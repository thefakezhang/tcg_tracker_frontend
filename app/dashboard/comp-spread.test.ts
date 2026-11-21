import { describe, expect, it } from "vitest";
import { belowBandPercent, spreadGeometry, spreadRatio, toCompSpread } from "./CompSpreadBar";

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

describe("spreadGeometry", () => {
  it("draws a median inside its band exactly as before: band full width", () => {
    const g = spreadGeometry({ p25: 120, p75: 180, median: 150 });
    expect(g).toEqual({ lo: 120, hi: 180, bandLeft: 0, bandWidth: 100, marker: 50 });
  });

  // Surugaya's sell row is the cheapest of every store's offer: マーレイン at
  // ¥260 against a band of ¥390-¥573 (2026-11-21). Pinned to the band's edge it
  // would read the same as a price at ¥390.
  it("puts a price below its band left of the band, not on its edge", () => {
    const g = spreadGeometry({ p25: 390, p75: 573, median: 260 });
    expect(g.lo).toBe(260);
    expect(g.hi).toBe(573);
    expect(g.marker).toBe(0);
    expect(g.bandLeft).toBeCloseTo(41.53, 1);
    expect(g.bandLeft + g.bandWidth).toBeCloseTo(100, 6);
  });

  it("keeps the old centre pin when every comp shares one price", () => {
    expect(spreadGeometry({ p25: 50, p75: 50, median: 50 })).toEqual({
      lo: 50, hi: 50, bandLeft: 0, bandWidth: 100, marker: 50,
    });
  });
});

describe("belowBandPercent", () => {
  it("names an outlier low as a whole percent of P25", () => {
    expect(belowBandPercent({ p25: 390, p75: 573, median: 260 })).toBe(33);
    expect(belowBandPercent({ p25: 965, p75: 995, median: 500 })).toBe(48);
  });

  it("stays quiet inside the band, above it, or just under it", () => {
    expect(belowBandPercent({ p25: 120, p75: 180, median: 150 })).toBeNull();
    expect(belowBandPercent({ p25: 120, p75: 180, median: 200 })).toBeNull();
    // ココドラ: ¥100 against ¥115-¥145 is 13% under, within the noise.
    expect(belowBandPercent({ p25: 115, p75: 145, median: 100 })).toBeNull();
  });

  it("does not divide by a zero P25", () => {
    const spread = toCompSpread(0, 0, 10);
    expect(spread && belowBandPercent(spread)).toBeNull();
  });
});
