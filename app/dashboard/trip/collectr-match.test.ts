// Regression guard for Collectr CSV -> catalog card resolution.
//
// INVARIANT (holds for every case below): a Collectr export is always English.
// Every `collectrName` here is a name a real export could produce; the Japanese
// lives only on the catalog side, in regional_name, which is exactly where the
// original bug came from.
//
// The rule (docs/matching.md): Collectr is set-less, so card_number narrows but
// does not identify, and the NAME confirms. Each tier needs a unique hit, and an
// unconfirmed guess must never import on a default - a wrong card_id silently
// misprices a lot line and nothing downstream flags it.
import { describe, it, expect } from "vitest";
import { resolveCard, type CandidateDef } from "./collectr-match";

const def = (card_id: number, regional_name: string, english_name: string | null = null): CandidateDef =>
  ({ card_id, regional_name, english_name });

describe("resolveCard", () => {
  it("confirms an exact English-name match", () => {
    const cands = [def(1, "ピカチュウ＆ゼクロムGX", "Pikachu & Zekrom GX"), def(2, "リザードン", "Charizard")];
    expect(resolveCard(cands, "Pikachu & Zekrom Gx")).toEqual({ card: cands[0], status: "confirmed" });
  });

  it("folds width, punctuation and Collectr's (JP) marker", () => {
    const cands = [def(1, "ミュウ", "Ｍｅｗ")];
    expect(resolveCard(cands, "Mew (JP)").status).toBe("confirmed");
  });

  it("NEVER auto-picks a candidate when no English name agrees", () => {
    // THE bug, and it needs no Japanese in the CSV to fire. Every regional_name
    // here folds to "" (86% of the catalog does), and `n.includes("")` is always
    // true, so the old containment tier returned def(1) - an unrelated card -
    // with its Add box ticked. english_name is absent, so nothing can confirm.
    const cands = [def(1, "ニドキング"), def(2, "ピッピ"), def(3, "ヤドキング")];
    expect(resolveCard(cands, "Blastoise")).toEqual({ card: null, status: "none" });
  });

  it("NEVER auto-picks when English names exist but none match", () => {
    // Same bug, now with english_name populated: the exact tier misses and the
    // old containment tier still fell through to the first candidate.
    const cands = [def(1, "ニドキング", "Nidoking"), def(2, "ピッピ", "Clefairy")];
    expect(resolveCard(cands, "Blastoise")).toEqual({ card: null, status: "none" });
  });

  it("refuses to choose between two candidates sharing a name", () => {
    // A variant split we cannot resolve without set/misc: park it.
    const cands = [def(1, "リザードン", "Charizard"), def(2, "リザードン", "Charizard")];
    expect(resolveCard(cands, "Charizard")).toEqual({ card: null, status: "none" });
  });

  it("suggests but does not auto-import a containment match", () => {
    // "Shining Mew" contains "Mew". Attaching Mew would be wrong, so the curator
    // confirms rather than finding it later in the lot's valuation.
    const cands = [def(1, "ミュウ", "Mew")];
    expect(resolveCard(cands, "Shining Mew")).toEqual({ card: cands[0], status: "review" });
  });

  it("suggests but does not auto-import a lone candidate with no english_name", () => {
    // The number pins one card, but nothing can confirm it (english_name is one
    // of the ~1% that is null). Suggestion, not a match.
    const cands = [def(1, "爆誕のルギア", null)];
    expect(resolveCard(cands, "Explosive Birth Lugia")).toEqual({ card: cands[0], status: "review" });
  });

  it("prefers the exact match over a containment match on the same number", () => {
    const cands = [def(1, "ミュウ", "Mew"), def(2, "ひかるミュウ", "Shining Mew")];
    expect(resolveCard(cands, "Shining Mew")).toEqual({ card: cands[1], status: "confirmed" });
  });

  it("returns nothing for an empty candidate list or a nameless row", () => {
    expect(resolveCard([], "Pikachu")).toEqual({ card: null, status: "none" });
    const cands = [def(1, "ピカチュウ", "Pikachu"), def(2, "ピッピ", "Clefairy")];
    expect(resolveCard(cands, "")).toEqual({ card: null, status: "none" });
  });

  it("does not let a short name containment-match everything", () => {
    // Guards the "gx"/"ex" degenerate: a 2-char fold must not pull in cards.
    const cands = [def(1, "ゼクロムGX", "Gx"), def(2, "リザードン", "Charizard")];
    expect(resolveCard(cands, "Pikachu & Zekrom GX").status).toBe("none");
  });
});
