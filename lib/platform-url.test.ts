import { describe, expect, it } from "vitest";
import { normalizePlatformID, platformIDFromURL, platformSearchURL } from "./platform-url";

describe("platformIDFromURL", () => {
  it.each([
    ["https://www.tcgplayer.com/product/517824/pokemon-japan-x", "tcgplayer", "517824"],
    ["https://snkrdunk.com/tcg/pokemon/products/98765", "snkrdunk", "98765"],
    ["https://snkrdunk.com/trading-cards/98765", "snkrdunk", "98765"],
    ["https://app.collectr.com/product/618166", "collectr", "618166"],
    ["https://app.getcollectr.com/explore/product/618166", "collectr", "618166"],
    ["https://www.suruga-ya.jp/product/detail/123456789?foo=bar", "surugaya", "123456789"],
  ])("extracts %s", (url, platform, id) => {
    expect(platformIDFromURL(url)).toEqual({ platform, id });
  });

  it("keeps PriceCharting's path-shaped id whole", () => {
    expect(platformIDFromURL("https://www.pricecharting.com/game/pokemon-japanese-base-set/charizard-4?x=1"))
      .toEqual({ platform: "pricecharting", id: "pokemon-japanese-base-set/charizard-4" });
  });

  it("decodes Card Ladder's profile id from its filters", () => {
    const url = "https://app.cardladder.com/sales-history?filters=grader%3Apsa%7CprofileId%3Apsa-1907672";
    expect(platformIDFromURL(url)).toEqual({ platform: "cardladder", id: "psa-1907672" });
  });

  it("rejects an unknown host and a known host with the wrong route", () => {
    expect(platformIDFromURL("https://example.com/product/517824")).toBeNull();
    expect(platformIDFromURL("https://www.tcgplayer.com/search/product/517824")).toBeNull();
  });
});

describe("normalizePlatformID", () => {
  it("infers the platform from a pasted URL", () => {
    expect(normalizePlatformID("tcgplayer", "https://snkrdunk.com/tcg/pokemon/products/98765"))
      .toEqual({ platform: "snkrdunk", value: "98765", extracted: true, invalidURL: false });
  });

  it("leaves a bare id on the selected platform", () => {
    expect(normalizePlatformID("cardladder", "  psa-1907672  "))
      .toEqual({ platform: "cardladder", value: "psa-1907672", extracted: false, invalidURL: false });
  });

  it("does not allow an unrelated URL to become an id", () => {
    const url = "https://example.com/12345";
    expect(normalizePlatformID("tcgplayer", url))
      .toEqual({ platform: "tcgplayer", value: url, extracted: false, invalidURL: true });
  });
});

describe("platformSearchURL", () => {
  it("builds a search from name and set", () => {
    const url = platformSearchURL("tcgplayer", "リザードン", "SV1");
    expect(url).toContain("tcgplayer.com/search");
    expect(url).toContain(encodeURIComponent("リザードン SV1"));
  });

  it("omits an UNKNOWN set", () => {
    expect(platformSearchURL("pricecharting", "Pikachu", "UNKNOWN")).not.toContain("UNKNOWN");
  });

  it("returns an empty string without a direct search route", () => {
    expect(platformSearchURL("collectr", "Pikachu", "SV1")).toBe("");
    expect(platformSearchURL("tcgplayer", "", "")).toBe("");
  });
});
