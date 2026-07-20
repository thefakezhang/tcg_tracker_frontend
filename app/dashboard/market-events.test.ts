import { describe, expect, it } from "vitest";
import { eventsForDay, holdingExposureKey, monthGrid, type MarketEventRow } from "./market-events";

const event = {
  event_id: 1,
  starts_on: "2026-07-10",
  ends_on: "2026-07-12",
  kind: "tournament",
  scope: "global",
  scope_ref: null,
  card_ids: null,
  title: "Three-day event",
  note: "",
  source_url: null,
  confidence: "confirmed",
  source_key: null,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
} satisfies MarketEventRow;

describe("market event calendar helpers", () => {
  it("builds a stable six-week Sunday-to-Saturday grid", () => {
    const days = monthGrid(new Date(2026, 6, 1));
    expect(days).toHaveLength(42);
    expect(days[0].getDay()).toBe(0);
    expect(days[41].getDay()).toBe(6);
    expect(days.some((day) => day.getMonth() === 6 && day.getDate() === 31)).toBe(true);
  });

  it("renders a multi-day event on every inclusive date", () => {
    expect(eventsForDay([event], "2026-07-09")).toHaveLength(0);
    expect(eventsForDay([event], "2026-07-10")).toHaveLength(1);
    expect(eventsForDay([event], "2026-07-12")).toHaveLength(1);
    expect(eventsForDay([event], "2026-07-13")).toHaveLength(0);
  });

  it("uses the same key for a holding and its exposure row", () => {
    const holding = { game: "pokemon", leg: "import", card_id: 42, product_id: null, condition_id: 3, psa_grade: 0, sealed_condition: null, variant_edition: null };
    const exposure = { ...holding, event_id: 9 };
    expect(holdingExposureKey(holding)).toBe(holdingExposureKey(exposure));
  });
});
