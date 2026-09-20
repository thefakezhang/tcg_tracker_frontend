import { describe, expect, it } from "vitest";
import { pokemonVariantLabel, pokemonVariantSearchFilters, type PokemonFoilTreatment } from "./pokemon-variant";

describe("pokemonVariantLabel", () => {
  // This block used to render each case twice - once from a pre-cutover
  // compound misc_info with variant_attrs beside it, once from the residue -
  // and assert the two were identical. That parity was the point while both
  // shapes existed in the catalog.
  //
  // Neither half survives. The cutover rewrote every string, the backend's
  // 000502 refuses a misc_info that names an axis, and variant_attrs is being
  // dropped. So the compound input is no longer a state the catalog can be in,
  // and the cases assert the one rendering that remains.
  //
  // Worth recording why the compound half could not simply be kept: the label
  // now splits the residue on commas, and "復刻:1ED" joins its residual to its
  // edition with a colon. It would render "復刻:1ED,1ED". The old code avoided
  // that by reading variant_attrs, which the database had already split.
  it.each([
    { name: "first mirror", residual: "", edition: "first", foil_treatment: "mirror", expected: "ミラー,1ED" },
    { name: "residual first mirror", residual: "SA", edition: "first", foil_treatment: "mirror", expected: "SA,ミラー,1ED" },
    { name: "joined residual and edition", residual: "復刻", edition: "first", foil_treatment: "normal", expected: "復刻,1ED" },
    { name: "unlimited with residue", residual: "カードe", edition: "unlimited", foil_treatment: "normal", expected: "カードe,アンリミ" },
  ])("renders $name from the residue and the typed axes", (testCase) => {
    expect(pokemonVariantLabel({
      misc_info: testCase.residual,
      edition: testCase.edition,
      foil_treatment: testCase.foil_treatment,
    })).toBe(testCase.expected);
  });

  // A payload that selects neither axis renders its residue and nothing more.
  // It used to render a compound misc_info verbatim, which is no longer a value
  // the catalog can hold.
  it("renders a payload that selects no typed axis as its residue alone", () => {
    expect(pokemonVariantLabel({ misc_info: "SA" })).toBe("SA");
  });

  it("uses the typed axes beside the residue", () => {
    expect(pokemonVariantLabel({
      misc_info: "SA",
      edition: "first",
      foil_treatment: "mirror",
    })).toBe("SA,ミラー,1ED");
  });

  it.each([
    ["mirror", "ミラー"],
    ["reverse", "リバース"],
    ["master_ball_mirror", "マスターボールミラー"],
    ["monster_ball_mirror", "モンスターボールミラー"],
    ["energy_mark_mirror", "エネルギーマークミラー"],
    ["rocket_mark_mirror", "ロケット団マークミラー"],
    ["dark_ball_mirror", "ダークボールミラー"],
    ["love_ball_mirror", "ラブラブボールミラー"],
    ["friend_ball_mirror", "フレンドボールミラー"],
    ["quick_ball_mirror", "クイックボールミラー"],
    ["rocket_team_mirror", "R団ミラー"],
    ["break_mirror", "BREAKミラー"],
    ["other", "other"],
  ] satisfies [PokemonFoilTreatment, string][])("renders typed foil %s", (foil, expected) => {
    expect(pokemonVariantLabel({
      misc_info: "UNKNOWN",
      edition: "not_applicable",
      foil_treatment: foil,
    })).toBe(expected);
  });

  it("keeps unknown, not-applicable, normal, and absent axes silent", () => {
    expect(pokemonVariantLabel({
      misc_info: "UNKNOWN",
      edition: "unknown",
      foil_treatment: "normal",
    })).toBeNull();
    expect(pokemonVariantLabel({
      misc_info: "25th",
    })).toBe("25th");
  });
});

describe("pokemonVariantSearchFilters", () => {
  // A word finds the cards whose composed label contains it, which is what a
  // substring search over the compound misc_info found before Phase 3.
  it.each([
    ["1ed", ["edition.in.(first)"]],
    ["1ED", ["edition.in.(first)"]],
    ["アンリミ", ["edition.in.(unlimited)"]],
    ["リバース", ["foil_treatment.in.(reverse)"]],
    ["マスターボール", ["foil_treatment.in.(master_ball_mirror)"]],
    [
      "ミラー",
      [
        "foil_treatment.in.(mirror,master_ball_mirror,monster_ball_mirror,energy_mark_mirror,rocket_mark_mirror,dark_ball_mirror,love_ball_mirror,friend_ball_mirror,quick_ball_mirror,rocket_team_mirror,break_mirror)",
      ],
    ],
  ])("maps %s onto the typed axes", (word, expected) => {
    expect(pokemonVariantSearchFilters(word)).toEqual(expected);
  });

  it("adds nothing for a word no label contains", () => {
    expect(pokemonVariantSearchFilters("リザードン")).toEqual([]);
    expect(pokemonVariantSearchFilters("SA")).toEqual([]);
    expect(pokemonVariantSearchFilters("  ")).toEqual([]);
  });

  it("never matches the silent or catch-all treatments", () => {
    for (const word of ["normal", "unknown", "other", "not_applicable"]) {
      expect(pokemonVariantSearchFilters(word)).toEqual([]);
    }
  });

  it("agrees with the rendered label for every typed value", () => {
    const editions = ["first", "unlimited", "unknown", "not_applicable"];
    const foils = [
      "normal", "mirror", "reverse", "master_ball_mirror", "monster_ball_mirror",
      "energy_mark_mirror", "rocket_mark_mirror", "dark_ball_mirror", "love_ball_mirror",
      "friend_ball_mirror", "quick_ball_mirror", "rocket_team_mirror", "break_mirror",
    ];
    for (const word of ["1ED", "アンリミ", "ミラー", "ボール", "リバース", "R団"]) {
      const filters = pokemonVariantSearchFilters(word);
      for (const edition of editions) {
        for (const foil of foils) {
          const label = pokemonVariantLabel({ misc_info: "", edition, foil_treatment: foil }) ?? "";
          const matched = filters.some((filter) => {
            const [column, , list] = filter.split(".");
            const values = list.slice(1, -1).split(",");
            return values.includes(column === "edition" ? edition : foil);
          });
          expect(matched, `${word} against ${edition}/${foil} (label "${label}")`).toBe(
            label.toLowerCase().includes(word.toLowerCase()),
          );
        }
      }
    }
  });
});
