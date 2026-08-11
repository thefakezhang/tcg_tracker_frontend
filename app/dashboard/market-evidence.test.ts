import { describe, expect, it } from "vitest";
import {
  buildMarketEvidenceMaps,
  compareMarketEstimates,
  MARKET_DISCREPANCY_THRESHOLD,
} from "./market-evidence";

describe("compareMarketEstimates", () => {
  it.each([null, undefined, 0, -1, Number.NaN])(
    "treats an invalid Collectr value of %s as unavailable",
    (value) => {
      expect(compareMarketEstimates(value, 100)).toMatchObject({
        status: "unavailable",
        collectrUsd: null,
        tcgplayerUsd: 100,
      });
    },
  );

  it("keeps a Collectr-only estimate visible when TCGPlayer has no market value", () => {
    expect(compareMarketEstimates(81.21, null)).toEqual({
      status: "collectr_only",
      collectrUsd: 81.21,
      tcgplayerUsd: null,
      differencePct: null,
    });
  });

  it.each([
    [119, 100, 0.19],
    [81, 100, -0.19],
  ])("does not warn inside the 20 percent band", (collectr, tcgplayer, differencePct) => {
    expect(compareMarketEstimates(collectr, tcgplayer)).toMatchObject({
      status: "aligned",
      differencePct,
    });
  });

  it.each([
    [120, 100, 0.2],
    [80, 100, -0.2],
    [250, 100, 1.5],
  ])("warns at and beyond the 20 percent boundary", (collectr, tcgplayer, differencePct) => {
    const result = compareMarketEstimates(collectr, tcgplayer);
    expect(result.status).toBe("discrepant");
    expect(result.differencePct).toBeCloseTo(differencePct);
    expect(Math.abs(result.differencePct!)).toBeGreaterThanOrEqual(MARKET_DISCREPANCY_THRESHOLD);
  });
});

describe("buildMarketEvidenceMaps", () => {
  it("chooses the lowest positive duplicate deterministically", () => {
    const result = buildMarketEvidenceMaps(
      [42],
      [
        { card_id: 42, market_usd: 110 },
        { card_id: 42, market_usd: 100 },
      ],
      [
        { card_id: 42, price: 130 },
        { card_id: 42, price: 125 },
        { card_id: 42, price: 0 },
      ],
    );

    expect(result.tcgMarket.get(42)).toBe(100);
    expect(result.evidence.get(42)).toMatchObject({
      status: "discrepant",
      collectrUsd: 125,
      tcgplayerUsd: 100,
      differencePct: 0.25,
    });
  });
});
