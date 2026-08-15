import { describe, expect, it } from "vitest";
import {
  displayDeltaToImage,
  editImageBox,
  parseGridGeometry,
  shouldSubmitGeometryCorrection,
} from "./image-curation-geometry";

describe("image curation geometry", () => {
  it("preserves the legacy flat card bbox", () => {
    expect(parseGridGeometry({ x0: 1, y0: 2, x1: 11, y1: 22 })).toEqual({
      card: { x0: 1, y0: 2, x1: 11, y1: 22 },
      price: null,
    });
  });

  it("maps pointer deltas from rendered pixels to natural pixels", () => {
    expect(displayDeltaToImage(20, -10, 200, 100, 1000, 500))
      .toEqual({ dx: 100, dy: -50 });
  });

  it("moves and clamps a card box without resizing it", () => {
    expect(editImageBox({ x0: 70, y0: 70, x1: 100, y1: 100 }, "move", 50, 50, 120, 110))
      .toEqual({ x0: 90, y0: 80, x1: 120, y1: 110 });
  });

  it("resizes card and price boxes through the same pointer transform", () => {
    const card = editImageBox({ x0: 10, y0: 10, x1: 60, y1: 80 }, "se", 20, 10, 200, 200);
    const price = editImageBox({ x0: 10, y0: 82, x1: 60, y1: 100 }, "nw", -5, -4, 200, 200);
    expect(card).toEqual({ x0: 10, y0: 10, x1: 80, y1: 90 });
    expect(price).toEqual({ x0: 5, y0: 78, x1: 60, y1: 100 });
  });

  it("rejects a resize that would make the box degenerate", () => {
    const initial = { x0: 10, y0: 10, x1: 30, y1: 30 };
    expect(editImageBox(initial, "se", -30, -30, 100, 100)).toEqual(initial);
  });

  it("submits correction evidence only for a real edit with known source dimensions", () => {
    const baseline = {
      card: { x0: 10, y0: 20, x1: 110, y1: 220 },
      price: null,
    };
    expect(shouldSubmitGeometryCorrection(baseline, baseline, true, 1000, 500)).toBe(false);
    expect(shouldSubmitGeometryCorrection(
      { ...baseline, card: { ...baseline.card, x0: 11 } },
      baseline,
      true,
      1000,
      500,
    )).toBe(true);
    expect(shouldSubmitGeometryCorrection(
      { ...baseline, card: { ...baseline.card, x0: 11 } },
      baseline,
      false,
      1000,
      500,
    )).toBe(false);
    expect(shouldSubmitGeometryCorrection(
      { ...baseline, card: { ...baseline.card, x0: 11 } },
      baseline,
      true,
      0,
      0,
    )).toBe(false);
  });
});
