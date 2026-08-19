import { describe, expect, it } from "vitest";
import { canonicalName, foldName } from "./AopReviewTab";

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

describe("canonicalName", () => {
  it("writes the catalog's spelling of the feed's markup", () => {
    // The feed's tokens are not names. Storing them raw is how 39 twins of
    // cards we already held were created.
    expect(canonicalName("{MEGA}カメックスEX")).toBe("MカメックスEX");
    expect(canonicalName("ビクティニ{PRISM_STAR}")).toBe("ビクティニ◇");
  });

  it("leaves an ordinary name alone", () => {
    expect(canonicalName("ミジュマル")).toBe("ミジュマル");
    expect(canonicalName("")).toBe("");
  });

  it("only rewrites {MEGA} as a prefix, which is the only place it means M", () => {
    expect(canonicalName("なにか{MEGA}")).toBe("なにか{MEGA}");
  });
});
