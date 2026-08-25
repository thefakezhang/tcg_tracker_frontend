import { describe, expect, it, vi } from "vitest";
import { applyJapanExclusivityQuery } from "./use-card-data";
import type { JapanExclusivityMode } from "./japan-exclusivity";

describe("use-card-data Japanese exclusivity query builder", () => {
  for (const test of [
    { mode: "all", eq: [], or: [] },
    { mode: "artwork", eq: [["pokemon_card_definitions.japan_exclusive_artwork", true]], or: [] },
    { mode: "stamps", eq: [["pokemon_card_definitions.japan_exclusive_stamps", true]], or: [] },
    {
      mode: "either",
      eq: [],
      or: [[
        "japan_exclusive_artwork.eq.true,japan_exclusive_stamps.eq.true",
        { referencedTable: "pokemon_card_definitions" },
      ]],
    },
    {
      mode: "both",
      eq: [
        ["pokemon_card_definitions.japan_exclusive_artwork", true],
        ["pokemon_card_definitions.japan_exclusive_stamps", true],
      ],
      or: [],
    },
  ] satisfies { mode: JapanExclusivityMode; eq: unknown[][]; or: unknown[][] }[]) {
    it(`applies ${test.mode} to the real hook builder contract`, () => {
      const builder = {
        eq: vi.fn(),
        or: vi.fn(),
      };
      builder.eq.mockReturnValue(builder);
      builder.or.mockReturnValue(builder);

      expect(applyJapanExclusivityQuery(builder, "pokemon_card_definitions", test.mode)).toBe(builder);
      expect(builder.eq.mock.calls).toEqual(test.eq);
      expect(builder.or.mock.calls).toEqual(test.or);
    });
  }
});
