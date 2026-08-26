import { describe, expect, it, vi } from "vitest";
import { applyJapanExclusivityQuery } from "./use-card-data";
import type { JapanExclusivityDimension } from "./japan-exclusivity";

describe("use-card-data Japanese exclusivity query builder", () => {
  for (const test of [
    { label: "no selection", selected: [], eq: [], or: [] },
    { label: "artwork", selected: ["artwork"], eq: [["pokemon_card_definitions.japan_exclusive_artwork", true]], or: [] },
    { label: "stamps", selected: ["stamps"], eq: [["pokemon_card_definitions.japan_exclusive_stamps", true]], or: [] },
    {
      label: "both inclusive toggles",
      selected: ["artwork", "stamps"],
      eq: [],
      or: [[
        "japan_exclusive_artwork.eq.true,japan_exclusive_stamps.eq.true",
        { referencedTable: "pokemon_card_definitions" },
      ]],
    },
  ] satisfies { label: string; selected: JapanExclusivityDimension[]; eq: unknown[][]; or: unknown[][] }[]) {
    it(`applies ${test.label} to the real hook builder contract`, () => {
      const builder = {
        eq: vi.fn(),
        or: vi.fn(),
      };
      builder.eq.mockReturnValue(builder);
      builder.or.mockReturnValue(builder);

      expect(applyJapanExclusivityQuery(builder, "pokemon_card_definitions", new Set(test.selected))).toBe(builder);
      expect(builder.eq.mock.calls).toEqual(test.eq);
      expect(builder.or.mock.calls).toEqual(test.or);
    });
  }
});
