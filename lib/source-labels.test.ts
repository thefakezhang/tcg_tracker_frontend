import { describe, expect, it } from "vitest";
import { sourceLabel } from "./source-labels";

describe("sourceLabel", () => {
  it("formats source keys used by the browser filter", () => {
    expect(sourceLabel("expedition_gaming")).toBe("Expedition Gaming");
    expect(sourceLabel("tcgplayer")).toBe("TCGplayer");
    expect(sourceLabel("big_tcg")).toBe("BIG TCG");
  });

  it("keeps unknown source keys visible", () => {
    expect(sourceLabel("future_source")).toBe("future_source");
  });
});
