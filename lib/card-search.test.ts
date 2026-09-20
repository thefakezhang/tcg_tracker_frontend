import { describe, expect, it } from "vitest";
import {
  EXTERNAL_IDENTIFIER_LOOKUP_ERROR_CODE,
  externalIdMatches,
  smartSearchFilters,
  tokenizeSearchTerm,
  uidOrParts,
  uidRange,
} from "./card-search";
import { pokemonVariantSearchFilters } from "./pokemon-variant";

describe("tokenizeSearchTerm", () => {
  it("splits on whitespace and drops empties", () => {
    expect(tokenizeSearchTerm("blastoise  009/165")).toEqual(["blastoise", "009/165"]);
  });

  it("scrubs PostgREST or() syntax characters into separators", () => {
    expect(tokenizeSearchTerm("mew (SAR), 25%")).toEqual(["mew", "SAR", "25"]);
  });

  it("returns a single token unchanged for one-word terms", () => {
    expect(tokenizeSearchTerm(" pikachu ")).toEqual(["pikachu"]);
  });
});

describe("smartSearchFilters", () => {
  const COLS = ["regional_name", "card_number"];

  it("is empty for a blank term", () => {
    expect(smartSearchFilters("   ", COLS, "card_uid", "card_id", [])).toEqual([]);
  });

  it("yields one or() per token, each spanning every text column", () => {
    expect(smartSearchFilters("blastoise 009", COLS, "card_uid", "card_id", [])).toEqual([
      "regional_name.ilike.%blastoise%,card_number.ilike.%blastoise%",
      "regional_name.ilike.%009%,card_number.ilike.%009%",
    ]);
  });

  it("keeps single-token terms as exactly one or() argument", () => {
    expect(smartSearchFilters("pikachu", COLS, "card_uid", "card_id", [])).toEqual([
      "regional_name.ilike.%pikachu%,card_number.ilike.%pikachu%",
    ]);
  });

  it("a full uuid applies alone, never as a text token", () => {
    const uid = "0b7e9d6a-1234-4c9b-8def-0123456789ab";
    expect(smartSearchFilters(uid, COLS, "card_uid", "card_id", [])).toEqual([
      `card_uid.eq.${uid}`,
    ]);
  });

  it("an 8-hex prefix becomes the displayed-prefix range scan", () => {
    const filters = smartSearchFilters("0b7e9d6a", COLS, "card_uid", "card_id", []);
    expect(filters).toHaveLength(1);
    expect(filters[0]).toContain("card_uid.gte.0b7e9d6a-0000");
    expect(filters[0]).toContain("card_uid.lte.0b7e9d6a-ffff");
  });

  it("resolved external ids gate by id list and suppress text tokens", () => {
    expect(smartSearchFilters("123456", COLS, "card_uid", "card_id", [7, 9])).toEqual([
      "card_id.in.(7,9)",
    ]);
  });

  it("combines uid-prefix and external-id disjuncts in one or()", () => {
    const filters = smartSearchFilters("12345678", COLS, "card_uid", "card_id", [7]);
    expect(filters).toHaveLength(1);
    expect(filters[0]).toContain("card_uid.gte.12345678-0000");
    expect(filters[0]).toContain("card_id.in.(7)");
  });
});

describe("G8 Iono discoverability contract", () => {
  const INDEX_COLS = ["regional_name", "english_name", "set_code", "card_number"];
  const BROWSER_COLS = ["regional_name", "english_name", "misc_info", "card_number", "set_code"];
  const uid = "da807f6b-e540-44a1-bbbc-1b3179cf9211";

  it.each([
    ["Card Index", INDEX_COLS],
    ["Browser", BROWSER_COLS],
  ])("finds English name plus number on the %s query path", (_surface, cols) => {
    const filters = smartSearchFilters("Iono 124", cols, "card_uid", "card_id", []);
    expect(filters).toHaveLength(2);
    expect(filters[0]).toContain("english_name.ilike.%Iono%");
    expect(filters[1]).toContain("card_number.ilike.%124%");
  });

  it.each([
    ["Card Index", INDEX_COLS],
    ["Browser", BROWSER_COLS],
  ])("finds Japanese name plus number on the %s query path", (_surface, cols) => {
    const filters = smartSearchFilters("ナンジャモ 124", cols, "card_uid", "card_id", []);
    expect(filters).toHaveLength(2);
    expect(filters[0]).toContain("regional_name.ilike.%ナンジャモ%");
    expect(filters[1]).toContain("card_number.ilike.%124%");
  });

  it.each([
    ["Card Index", INDEX_COLS],
    ["Browser", BROWSER_COLS],
  ])("uses the exact uid alone on the %s query path", (_surface, cols) => {
    expect(smartSearchFilters(uid, cols, "card_uid", "card_id", [])).toEqual([
      `card_uid.eq.${uid}`,
    ]);
  });

  it.each([
    ["Card Index", INDEX_COLS],
    ["Browser", BROWSER_COLS],
  ])("uses the resolved TCGplayer id alone on the %s query path", (_surface, cols) => {
    expect(smartSearchFilters("545661", cols, "card_uid", "card_id", [42])).toEqual([
      "card_id.in.(42)",
    ]);
  });
});

describe("uidOrParts", () => {
  it("ignores terms that are neither uuid nor prefix", () => {
    expect(uidOrParts("blastoise", "card_uid")).toEqual([]);
    expect(uidOrParts("0b7e9d6", "card_uid")).toEqual([]);
  });
});

describe("externalIdMatches", () => {
  it("rejects identifier-table failures instead of turning them into no results", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: null, error: { message: "permission denied" } }),
          }),
        }),
      }),
    };

    const result = externalIdMatches(client, "pokemon_external_identifiers", "card_id", "545661");
    await expect(result).rejects.toMatchObject({
      name: "ExternalIdentifierLookupError",
      code: EXTERNAL_IDENTIFIER_LOOKUP_ERROR_CODE,
      message: "External identifier lookup is temporarily unavailable.",
    });
    await expect(result).rejects.not.toThrow(/permission denied|pokemon_external_identifiers/);
  });
});

describe("smartSearchFilters token filters", () => {
  const COLS = ["regional_name", "misc_info"];

  it("adds the typed variant disjuncts to each token's text columns", () => {
    expect(
      smartSearchFilters("リザードン 1ED", COLS, "card_uid", "card_id", [], pokemonVariantSearchFilters),
    ).toEqual([
      "regional_name.ilike.%リザードン%,misc_info.ilike.%リザードン%",
      "regional_name.ilike.%1ED%,misc_info.ilike.%1ED%,edition.in.(first)",
    ]);
  });

  it("leaves an identifier paste alone", () => {
    expect(
      smartSearchFilters("da807f6b", COLS, "card_uid", "card_id", [], pokemonVariantSearchFilters),
    ).toEqual(smartSearchFilters("da807f6b", COLS, "card_uid", "card_id", []));
  });

  it("adds nothing without the hook, so tables without typed columns stay valid", () => {
    expect(smartSearchFilters("1ED", COLS, "card_uid", "card_id", [])).toEqual([
      "regional_name.ilike.%1ED%,misc_info.ilike.%1ED%",
    ]);
  });
});

describe("uidRange", () => {
  it("returns an exact point for a full uuid", () => {
    const r = uidRange("0f8b2a1c-1111-4222-8333-444455556666");
    expect(r).toEqual({
      lo: "0f8b2a1c-1111-4222-8333-444455556666",
      hi: "0f8b2a1c-1111-4222-8333-444455556666",
    });
  });

  it("returns the inclusive range a displayed 8-hex prefix denotes", () => {
    expect(uidRange("0f8b2a1c")).toEqual({
      lo: "0f8b2a1c-0000-0000-0000-000000000000",
      hi: "0f8b2a1c-ffff-ffff-ffff-ffffffffffff",
    });
  });

  it("returns null for ordinary search text", () => {
    expect(uidRange("lightning bolt")).toBeNull();
    expect(uidRange("2x2")).toBeNull();
    expect(uidRange("")).toBeNull();
  });

  // uidOrParts composes its PostgREST strings from uidRange, so a term that
  // yields no range must yield no filter either: the two cannot disagree about
  // what counts as an identifier paste.
  it("agrees with uidOrParts about what is an identifier", () => {
    for (const term of ["0f8b2a1c", "0f8b2a1c-1111-4222-8333-444455556666", "bolt", "2x2", ""]) {
      expect(uidRange(term) === null).toBe(uidOrParts(term, "card_uid").length === 0);
    }
  });
});
