import { describe, expect, it } from "vitest";
import {
  SOURCE_OPTIONS_VIEW,
  summaryTableForSource,
} from "./source-availability";

describe("source availability query targets", () => {
  it("uses the global summary table when no source is selected", () => {
    expect(summaryTableForSource("pokemon", "")).toBe("pokemon_price_summaries");
    expect(summaryTableForSource("mtg", "")).toBe("mtg_price_summaries");
  });

  it("uses the source-presence view for singles", () => {
    expect(summaryTableForSource("pokemon", "expedition_gaming")).toBe(
      "pokemon_price_summaries_by_source_v",
    );
    expect(summaryTableForSource("mtg", "tcgplayer")).toBe(
      "mtg_price_summaries_by_source_v",
    );
  });

  it("does not claim source-presence support for sealed products", () => {
    expect(summaryTableForSource("pokemon_sealed", "cardrush_sealed")).toBe(
      "pokemon_sealed_summaries_v",
    );
  });

  it("uses the compact server-side source options view", () => {
    expect(SOURCE_OPTIONS_VIEW).toBe("card_browser_source_options_v");
  });
});
