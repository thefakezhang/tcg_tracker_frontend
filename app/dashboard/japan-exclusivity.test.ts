import { describe, expect, it } from "vitest";
import {
  japanExclusivityQueryFilter,
  matchesJapanExclusivity,
  type JapanExclusivityMode,
} from "./japan-exclusivity";

describe("Japanese exclusivity filter truth table", () => {
  const modes: JapanExclusivityMode[] = ["all", "artwork", "stamps", "either", "both"];
  const expected = new Map<string, boolean[]>([
    ["00", [true, false, false, false, false]],
    ["01", [true, false, true, true, false]],
    ["10", [true, true, false, true, false]],
    ["11", [true, true, true, true, true]],
  ]);

  for (const artwork of [false, true]) {
    for (const stamps of [false, true]) {
      const key = `${Number(artwork)}${Number(stamps)}`;
      it(`${key} distinguishes the two evidence-backed categories`, () => {
        const got = modes.map((mode) => matchesJapanExclusivity({
          japan_exclusive_artwork: artwork,
          japan_exclusive_stamps: stamps,
        }, mode));
        expect(got).toEqual(expected.get(key));
      });
    }
  }
});

describe("Japanese exclusivity query contract", () => {
  it("uses only the two evidence-backed columns", () => {
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
  });
});
