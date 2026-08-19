import { describe, expect, it } from "vitest";
import { foldName } from "./AopReviewTab";

// foldName decides which catalog cards are shown beside a candidate as possible
// duplicates, so it has to agree with matchreview.FoldCardName on the backend.
// Getting it wrong either hides the duplicate the reviewer needs to see, or
// buries the row in cards that are not it.
describe("foldName", () => {
  it("ignores width, case and spacing", () => {
    expect(foldName("ピッチのピカチュウ")).toBe(foldName("ピッチのピカチュウ "));
    expect(foldName("No.1 Trainer")).toBe(foldName("no.1trainer"));
    // NFKC folds the full-width forms sources disagree on.
    expect(foldName("ＭリザードンＥＸ")).toBe(foldName("MリザードンEX"));
  });

  it("unwraps a one-character bracket group but keeps the letter", () => {
    // Sources write the same Unown as アンノーン[J] and アンノーンJ.
    expect(foldName("アンノーン[J]")).toBe(foldName("アンノーンJ"));
    // The letter is the identity: two different Unown must not fold together.
    expect(foldName("アンノーン[J]")).not.toBe(foldName("アンノーン[R]"));
  });

  it("keeps distinct cards distinct", () => {
    expect(foldName("ひかるミュウ")).not.toBe(foldName("ひかるミュウツー"));
    expect(foldName("カメックス")).not.toBe(foldName("カメール"));
  });

  it("survives empty and missing input", () => {
    expect(foldName("")).toBe("");
    expect(foldName(undefined as unknown as string)).toBe("");
  });
});
