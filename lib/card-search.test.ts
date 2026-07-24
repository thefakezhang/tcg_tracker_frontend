import { describe, expect, it } from "vitest";
import { smartSearchFilters, tokenizeSearchTerm, uidOrParts } from "./card-search";

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

describe("uidOrParts", () => {
  it("ignores terms that are neither uuid nor prefix", () => {
    expect(uidOrParts("blastoise", "card_uid")).toEqual([]);
    expect(uidOrParts("0b7e9d6", "card_uid")).toEqual([]);
  });
});
