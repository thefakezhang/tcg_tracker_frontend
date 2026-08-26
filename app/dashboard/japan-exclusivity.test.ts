import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en";
import ja from "@/lib/i18n/ja";
import {
  japanExclusivityQueryFilter,
  japanExclusivitySelectionQueryFilter,
  matchesJapanExclusivity,
  matchesJapanExclusivitySelection,
  type JapanExclusivityDimension,
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

describe("Japanese exclusivity inclusive toggle truth table", () => {
  const selections: JapanExclusivityDimension[][] = [[], ["artwork"], ["stamps"], ["artwork", "stamps"]];
  const expected = new Map<string, boolean[]>([
    ["00", [true, false, false, false]],
    ["01", [true, false, true, true]],
    ["10", [true, true, false, true]],
    ["11", [true, true, true, true]],
  ]);

  for (const artwork of [false, true]) {
    for (const stamps of [false, true]) {
      const key = `${Number(artwork)}${Number(stamps)}`;
      it(`${key} treats two selected buttons as an inclusive union`, () => {
        expect(selections.map((selection) => matchesJapanExclusivitySelection({
          japan_exclusive_artwork: artwork,
          japan_exclusive_stamps: stamps,
        }, new Set(selection)))).toEqual(expected.get(key));
      });
    }
  }

  it("turns two selected dimensions into an OR query", () => {
    expect(japanExclusivitySelectionQueryFilter(new Set(["artwork", "stamps"]))).toEqual({
      equalsTrue: [],
      anyOfTrue: ["japan_exclusive_artwork", "japan_exclusive_stamps"],
    });
  });
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

  it("keeps reviewed version and evolving-corpus scope beside filters and customer criteria", () => {
    for (const key of ["cardBrowser.jpExclusiveHint", "customers.japanExclusivity.hint"] as const) {
      expect(en[key]).toContain("Reviewed through Aug 26, 2026");
      expect(en[key]).toContain("v2026-08-26.1");
      expect(en[key]).toContain("approvals evolve");
      expect(ja[key]).toContain("2026年8月26日");
      expect(ja[key]).toContain("v2026-08-26.1");
      expect(ja[key]).toContain("承認リストは更新されます");
    }
  });
});
