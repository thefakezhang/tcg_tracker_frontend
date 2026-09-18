import { describe, expect, it } from "vitest";
import { pokemonVariantLabel, pokemonVariantSearchFilters, type PokemonFoilTreatment } from "./pokemon-variant";

describe("pokemonVariantLabel", () => {
  it.each([
    {
      name: "first mirror",
      edition: "first",
      foil_treatment: "mirror",
      compound: "ミラー,1ED",
      residual: "",
      variant_attrs: [],
      expected: "ミラー,1ED",
    },
    {
      name: "residual first mirror",
      edition: "first",
      foil_treatment: "mirror",
      compound: "SA,ミラー,1ED",
      residual: "SA",
      variant_attrs: ["SA"],
      expected: "SA,ミラー,1ED",
    },
    {
      name: "joined residual and edition",
      edition: "first",
      foil_treatment: "normal",
      compound: "復刻:1ED",
      residual: "復刻",
      variant_attrs: ["復刻"],
      expected: "復刻,1ED",
    },
    {
      name: "unlimited with residue",
      edition: "unlimited",
      foil_treatment: "normal",
      compound: "カードe, アンリミ",
      residual: "カードe",
      variant_attrs: ["カードe"],
      expected: "カードe,アンリミ",
    },
  ])("renders $name identically before and after the misc rewrite", (testCase) => {
    const before = pokemonVariantLabel({
      misc_info: testCase.compound,
      edition: testCase.edition,
      foil_treatment: testCase.foil_treatment,
      variant_attrs: testCase.variant_attrs,
    });
    const after = pokemonVariantLabel({
      misc_info: testCase.residual,
      edition: testCase.edition,
      foil_treatment: testCase.foil_treatment,
      variant_attrs: testCase.variant_attrs,
    });

    expect(before).toBe(testCase.expected);
    expect(after).toBe(before);
  });

  it("keeps an older misc-only API payload unchanged", () => {
    expect(pokemonVariantLabel({ misc_info: "SA,ミラー,1ED" })).toBe("SA,ミラー,1ED");
  });

  it("uses typed axes with a residual-only payload when variant_attrs is unavailable", () => {
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
      variant_attrs: [],
    })).toBe(expected);
  });

  it("keeps unknown, not-applicable, normal, and absent axes silent", () => {
    expect(pokemonVariantLabel({
      misc_info: "UNKNOWN",
      edition: "unknown",
      foil_treatment: "normal",
      variant_attrs: [],
    })).toBeNull();
    expect(pokemonVariantLabel({
      misc_info: "25th",
      variant_attrs: ["25th"],
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
          const label = pokemonVariantLabel({ misc_info: "", edition, foil_treatment: foil, variant_attrs: [] }) ?? "";
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
