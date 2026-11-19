import { describe, expect, it } from "vitest";
import { channelRows, rankedChannels, type ExitOptionRow } from "./ExitChannelPanel";

const base: ExitOptionRow = {
  card_id: 810212, psa_grade: 0,
  market_usd: 25.96, market_source: "tcgplayer_market",
  tcg_realized_usd: 24.75, tcg_low_usd: 18.15, tcg_high_usd: 26.79, tcg_units: 34,
  ebay_realized_usd: 18.4, ebay_p25_usd: 9, ebay_p75_usd: 25.91, ebay_comps: 7,
  tcg_net_usd: 19.67, ebay_net_usd: 11.85,
  in_person_net_usd: 21.99, vendor_net_usd: 13.58,
  best_channel: "in_person", best_net_usd: 21.99, updated_at: null,
};

describe("rankedChannels", () => {
  it("orders by net, best first", () => {
    expect(rankedChannels(base).map((c) => c.key)).toEqual([
      "in_person", "tcgplayer", "vendor", "ebay",
    ]);
  });

  // A null net is NOT zero. It means the channel could not be priced at all -
  // no market reference for the derived ones, no sales for the measured ones -
  // which reads differently from "this channel pays nothing" and must not sort
  // as if it did, or an unpriceable channel outranks a genuinely poor one.
  it("sorts unpriceable channels last rather than treating them as zero", () => {
    const row = { ...base, in_person_net_usd: null, vendor_net_usd: null };
    const order = rankedChannels(row).map((c) => c.key);
    expect(order.slice(0, 2)).toEqual(["tcgplayer", "ebay"]);
    expect(order.slice(2).sort()).toEqual(["in_person", "vendor"]);
  });

  it("does not rank a negative net below an unpriceable one", () => {
    const row = { ...base, ebay_net_usd: -4.75, in_person_net_usd: null, vendor_net_usd: null };
    const order = rankedChannels(row).map((c) => c.key);
    expect(order.indexOf("ebay")).toBeLessThan(order.indexOf("in_person"));
  });
});

describe("channelRows", () => {
  // The distinction this whole panel exists to preserve: TCGplayer and eBay
  // rest on this card's own sales, in-person and vendor on a book-wide rate.
  // Presenting a derived number as a measured one is the mistake it prevents.
  it("marks measured and derived channels apart", () => {
    const byKey = Object.fromEntries(channelRows(base).map((c) => [c.key, c.basis]));
    expect(byKey).toEqual({
      tcgplayer: "measured", ebay: "measured",
      in_person: "derived", vendor: "derived",
    });
  });

  it("shows the sample behind each measured channel", () => {
    const rows = channelRows(base);
    expect(rows.find((c) => c.key === "tcgplayer")!.detail).toContain("34 sold");
    expect(rows.find((c) => c.key === "ebay")!.detail).toContain("7 comps");
  });

  it("gives a derived channel no sample, only the market it came from", () => {
    const inPerson = channelRows(base).find((c) => c.key === "in_person")!;
    expect(inPerson.detail).toContain("market");
    expect(inPerson.detail).not.toMatch(/sold|comps/);
  });

  it("omits the detail entirely when there is no market to derive from", () => {
    const row = { ...base, market_usd: null };
    expect(channelRows(row).find((c) => c.key === "vendor")!.detail).toBeNull();
  });
});
