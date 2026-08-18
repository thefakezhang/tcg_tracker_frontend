import { describe, expect, it } from "vitest";
import { isOpaqueLinkID, linkChipLabel, platformShort, sourceLabel } from "./source-labels";

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

describe("link chip labels", () => {
  it("prints platform-native ids in full", () => {
    expect(linkChipLabel("tcgplayer", "604028")).toBe("TCG 604028");
    expect(linkChipLabel("collectr", "10024007")).toBe("COLL 10024007");
    expect(linkChipLabel("cardkingdom", "psa10:090/066")).toBe("CK psa10:090/066");
    expect(linkChipLabel("toban", "buy:21255")).toBe("TOBAN buy:21255");
  });

  it("collapses torecabirth's buyback row uid to the platform - the raw key belongs on the tooltip", () => {
    const uid = "pokemon__3116a9c7-48b4-4812-a125-e5550b617107__218";
    expect(isOpaqueLinkID("torecabirth", uid)).toBe(true);
    expect(linkChipLabel("torecabirth", uid)).toBe("TB");
  });

  it("collapses identity keys (name|number|misc) from shops without item pages", () => {
    expect(isOpaqueLinkID("big_tcg", "ゲッコウガex|090/066|UNKNOWN")).toBe(true);
    expect(isOpaqueLinkID("torecabank", "ゲッコウガex|090/066|UNKNOWN")).toBe(true);
    expect(isOpaqueLinkID("expedition_gaming", "SV5A|090/066")).toBe(true);
    expect(linkChipLabel("big_tcg", "ゲッコウガex|090/066|UNKNOWN")).toBe("BIG");
    // A real product id on the same shop stays readable.
    expect(isOpaqueLinkID("big_tcg", "sell:12345")).toBe(false);
  });

  it("falls back to the raw platform name for unknown platforms", () => {
    expect(platformShort("newshop")).toBe("newshop");
    expect(linkChipLabel("newshop", "42")).toBe("newshop 42");
  });
});
