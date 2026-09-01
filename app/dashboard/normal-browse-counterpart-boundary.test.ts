import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function dashboardSource(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");
}

describe("ordinary card browse counterpart boundary", () => {
  it.each(["CardBrowser.tsx", "CardDetailModal.tsx", "columns.tsx"])(
    "%s has no counterpart fetch or render plumbing",
    (name) => {
      const source = dashboardSource(name);

      expect(source).not.toMatch(/english-counterpart/i);
      expect(source).not.toContain("useEnglishCounterparts");
      expect(source).not.toContain("EnglishCounterpartPanel");
      expect(source).not.toContain("pokemon_english_counterpart_card_v");
    },
  );

  it("keeps the dedicated counterpart review route registered", () => {
    expect(dashboardSource("EnglishCounterpartReviewView.tsx"))
      .toContain('from "./english-counterpart"');
    expect(dashboardSource("views.tsx"))
      .toContain('slug: "counterparts"');
  });
});
