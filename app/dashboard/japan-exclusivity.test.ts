import { describe, expect, it } from "vitest";
import {
  japanExclusivityQueryFilter,
  matchesJapanExclusivity,
  type JapanExclusivityMode,
} from "./japan-exclusivity";

describe("Japanese exclusivity filter truth table", () => {
  const modes: JapanExclusivityMode[] = ["all", "artwork", "stamps", "either", "both", "legacy"];
  const expected = new Map<string, boolean[]>([
    ["000", [true, false, false, false, false, false]],
    ["001", [true, false, false, false, false, true]],
    ["010", [true, false, true, true, false, false]],
    ["011", [true, false, true, true, false, true]],
    ["100", [true, true, false, true, false, false]],
    ["101", [true, true, false, true, false, true]],
    ["110", [true, true, true, true, true, false]],
    ["111", [true, true, true, true, true, true]],
  ]);

  for (const artwork of [false, true]) {
    for (const stamps of [false, true]) {
      for (const legacy of [false, true]) {
        const key = `${Number(artwork)}${Number(stamps)}${Number(legacy)}`;
        it(`${key} distinguishes typed categories from legacy`, () => {
          const got = modes.map((mode) => matchesJapanExclusivity({
            japan_exclusive_artwork: artwork,
            japan_exclusive_stamps: stamps,
            is_japan_exclusive: legacy,
          }, mode));
          expect(got).toEqual(expected.get(key));
        });
      }
    }
  }
});

describe("Japanese exclusivity query contract", () => {
  it("keeps legacy out of every typed filter", () => {
    expect(japanExclusivityQueryFilter("artwork")).toEqual({
      equalsTrue: ["japan_exclusive_artwork"],
      anyOfTrue: [],
    });
    expect(japanExclusivityQueryFilter("stamps")).toEqual({
      equalsTrue: ["japan_exclusive_stamps"],
      anyOfTrue: [],
    });
    expect(japanExclusivityQueryFilter("either")).toEqual({
      equalsTrue: [],
      anyOfTrue: ["japan_exclusive_artwork", "japan_exclusive_stamps"],
    });
    expect(japanExclusivityQueryFilter("both")).toEqual({
      equalsTrue: ["japan_exclusive_artwork", "japan_exclusive_stamps"],
      anyOfTrue: [],
    });
    expect(japanExclusivityQueryFilter("legacy")).toEqual({
      equalsTrue: ["is_japan_exclusive"],
      anyOfTrue: [],
    });
  });
});
