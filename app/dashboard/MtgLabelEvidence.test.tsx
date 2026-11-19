// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MtgFormatBadges, MtgLabelEvidence } from "./MtgLabelEvidence";
import { formatPlayTrend, hasAnyMtgLabel, mtgTagSelectionQueryFilter } from "./mtg-tags";

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
    language: "en",
  }),
}));

afterEach(cleanup);

describe("MtgLabelEvidence", () => {
  // One row per WRITER, not per label. The three cEDH tags come from one weekly
  // refresh and share one reason, so three rows would print the same sentence
  // three times and imply the three were established independently.
  it("groups the cEDH tags into a single row naming each active tag", () => {
    render(<MtgLabelEvidence card={{
      is_cedh_staple: true,
      is_top_commander: true,
      is_cedh_exclusive: false,
      edhrec_tags_reason: "95,281 decks; synergy +0.42",
      edhrec_tags_evidence_url: "https://edhrec.test/cards/rhystic-study",
      edhrec_tags_as_of: "2026-10-19T04:00:00Z",
    }} />);

    expect(screen.queryAllByTestId("mtg-label-edhrecTags")).toHaveLength(1);
    const row = screen.getByTestId("mtg-label-edhrecTags");
    expect(row.textContent).toContain("mtgLabel.cedhStaple");
    expect(row.textContent).toContain("mtgLabel.topCommander");
    expect(row.textContent).not.toContain("mtgLabel.cedhExclusive");
    expect(row.textContent).toContain("95,281 decks; synergy +0.42");
    expect(row.getAttribute("href")).toBe("https://edhrec.test/cards/rhystic-study");
  });

  // The two groups are separate jobs on separate cadences, so a card carrying
  // both labels gets both rows with their own reason, link and date.
  it("renders the demand label as its own row with its own provenance", () => {
    render(<MtgLabelEvidence card={{
      is_cedh_staple: true,
      edhrec_tags_reason: "95,281 decks; synergy +0.42",
      edhrec_tags_evidence_url: "https://edhrec.test/cards/rhystic-study",
      edhrec_tags_as_of: "2026-10-19T04:00:00Z",
      is_commander_stockable: true,
      commander_demand_reason: "108,150 decks across 9 commanders, 27 priced printings, median $8.03",
      commander_demand_evidence_url: "https://edhrec.test/top/year",
      commander_demand_as_of: "2026-10-12T04:00:00Z",
    }} />);

    const demand = screen.getByTestId("mtg-label-commanderDemand");
    expect(demand.textContent).toContain("mtgLabel.stockable");
    expect(demand.textContent).toContain("27 priced printings");
    expect(demand.getAttribute("href")).toBe("https://edhrec.test/top/year");
    // Its own date, a week behind the tags: the two jobs do not run together,
    // and showing one date for both would misdate whichever ran earlier.
    expect(demand.textContent).toContain("Oct 12, 2026");
    expect(screen.getByTestId("mtg-label-edhrecTags").textContent).toContain("Oct 19, 2026");
  });

  // The date is the point of the provenance: 000564 exists because a reader
  // could not tell a staple from a stale flag.
  it("dates the measurement", () => {
    render(<MtgLabelEvidence card={{
      is_commander_stockable: true,
      commander_demand_reason: "50,339 decks across 4 commanders, 10 priced printings, median $7.77",
      commander_demand_as_of: "2026-10-19T04:35:21Z",
    }} />);
    expect(screen.getByTestId("mtg-label-commanderDemand").textContent)
      .toContain("mtgLabel.asOf:Oct 19, 2026");
  });

  // A card tagged before 000564 carries the boolean with every provenance
  // field still null. The label is still true, so the row must render - saying
  // that the evidence is missing rather than hiding the label.
  it("renders a label whose provenance predates the columns", () => {
    render(<MtgLabelEvidence card={{ is_cedh_exclusive: true }} />);
    const row = screen.getByTestId("mtg-label-edhrecTags");
    expect(row.textContent).toContain("mtgLabel.evidenceUnavailable");
    expect(row.textContent).not.toContain("mtgLabel.asOf");
    // No URL means no link, so nothing is focusable and nothing claims to
    // lead somewhere.
    expect(row.tagName).toBe("DIV");
  });

  // The row sits inside a clickable table row and a clickable grid tile.
  it("keeps the evidence link reachable and tappable", () => {
    render(<MtgLabelEvidence card={{
      is_cedh_staple: true,
      edhrec_tags_reason: "95,281 decks",
      edhrec_tags_evidence_url: "https://edhrec.test/cards/rhystic-study",
    }} />);
    const row = screen.getByTestId("mtg-label-edhrecTags");
    expect(row.className).toContain("min-h-11");
    expect(row.className).toContain("items-center");
    expect(row.getAttribute("rel")).toBe("noreferrer");
    expect(row.getAttribute("target")).toBe("_blank");
    row.focus();
    expect(document.activeElement).toBe(row);
  });

  // Every MTG row in the browser renders this component, labelled or not, the
  // way the Pokemon rows render JapanExclusiveEvidence.
  it("renders nothing for an unlabelled card", () => {
    const { container } = render(<MtgLabelEvidence card={{}} />);
    expect(container.textContent).toBe("");
  });

  // The Reserved List comes from MTGJSON, is per printing, and has no
  // measurement behind it. It is a filter chip, not an evidence row.
  it("renders nothing for a card that is only on the Reserved List", () => {
    const { container } = render(<MtgLabelEvidence card={{ is_reserved: true }} />);
    expect(container.textContent).toBe("");
  });

  // mtgtop8 measures each format on its own page (backend 000664), so a card
  // played in two formats gets two rows, each with its own share and link.
  it("renders one row per active format with that format's own evidence", () => {
    render(<MtgLabelEvidence card={{
      is_modern_played: true,
      is_legacy_played: true,
      is_standard_played: false,
      format_play: {
        MO: { reason: "33.3% of 3,477 decks, 2.8 copies", url: "https://www.mtgtop8.com/topcards?f=MO&meta=51", as_of: "2026-11-22T10:00:00Z", main_pct: 33.3, main_pct_2w: 35.1 },
        LE: { reason: "12.0% of 2,564 decks, 1.5 copies", url: "https://www.mtgtop8.com/topcards?f=LE&meta=39", main_pct: 12, main_pct_2w: 6 },
      },
    }} />);
    const modern = screen.getByTestId("mtg-label-format-MO");
    expect(modern.textContent).toContain("mtgLabel.modernPlayed");
    expect(modern.textContent).toContain("33.3% of 3,477 decks");
    expect(modern.getAttribute("href")).toBe("https://www.mtgtop8.com/topcards?f=MO&meta=51");
    // 35.1 against 33.3 is under a quarter relative: steady, no arrow.
    expect(screen.queryByTestId("mtg-label-format-MO-trend-up")).toBeNull();
    // 6 against 12 is a clear fall, and the arrow says by how much.
    const legacyTrend = screen.getByTestId("mtg-label-format-LE-trend-down");
    expect(legacyTrend.getAttribute("aria-label")).toBe("mtgLabel.trendDownMain:6");
    expect(screen.queryByTestId("mtg-label-format-ST")).toBeNull();
  });

  it("renders a format label whose evidence object is missing", () => {
    render(<MtgLabelEvidence card={{ is_cedh_played: true }} />);
    expect(screen.getByTestId("mtg-label-format-cEDH").textContent).toContain("mtgLabel.evidenceUnavailable");
  });
});

describe("MtgFormatBadges", () => {
  const card = {
    is_modern_played: true,
    is_cedh_played: true,
    format_play: {
      MO: { reason: "4.1% of 3,477 decks, 4.0 copies", url: "https://www.mtgtop8.com/topcards?f=MO&meta=51", main_pct: 4.1, main_pct_2w: 9 },
      cEDH: { reason: "commander in 17.0%", side_pct: 17, side_pct_2w: 16 },
    },
  };

  it("links each badge to its format's page and carries the reason in its title", () => {
    render(<MtgFormatBadges card={card} />);
    const modern = screen.getByTestId("mtg-format-badge-MO");
    expect(modern.tagName).toBe("A");
    expect(modern.getAttribute("title")).toContain("4.1% of 3,477 decks");
    expect(modern.getAttribute("title")).toContain("mtgLabel.trendUpMain:9");
    // No url recorded: a plain badge, not a dead link.
    expect(screen.getByTestId("mtg-format-badge-cEDH").tagName).toBe("SPAN");
  });

  // The inventory grid tile is a <button>; a link inside it is invalid.
  it("renders no links when linked is false", () => {
    const { container } = render(<MtgFormatBadges card={card} linked={false} />);
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByTestId("mtg-format-badge-MO").tagName).toBe("SPAN");
  });

  it("renders nothing for a card played in no tracked format", () => {
    const { container } = render(<MtgFormatBadges card={{ is_cedh_staple: true }} />);
    expect(container.textContent).toBe("");
  });
});

describe("format labels in mtg-tags", () => {
  it("reads the clearer of the two boards and names it", () => {
    expect(formatPlayTrend({ main_pct: 10, main_pct_2w: 10.5, side_pct: 4, side_pct_2w: 9 }))
      .toEqual({ direction: "up", board: "side", recent: 9 });
    expect(formatPlayTrend({ main_pct: 3, main_pct_2w: 3.4 })).toBeNull();
    // Absent from the last two weeks is under the floor, not a measured zero.
    expect(formatPlayTrend({ main_pct: 5 })).toEqual({ direction: "down", board: "main", recent: null });
    expect(formatPlayTrend(undefined)).toBeNull();
  });

  // The independent check found the text quoting the main-deck share while
  // the arrow was about the sideboard: Teferi, Time Raveler read "Falling:
  // 18.6%" in Modern, which was its main-deck share going up.
  it("quotes the board the arrow is about", () => {
    render(<MtgLabelEvidence card={{
      is_modern_played: true,
      format_play: { MO: { main_pct: 15.4, main_pct_2w: 18.6, side_pct: 9.1, side_pct_2w: 3.0, reason: "15.4% of 3,477 decks" } },
    }} />);
    const trend = screen.getByTestId("mtg-label-format-MO-trend-down");
    expect(trend.getAttribute("aria-label")).toBe("mtgLabel.trendDownSide:3");
  });

  it("says under 1% for a card gone from the two-week list, and commanders for cEDH", () => {
    render(<MtgFormatBadges card={{
      is_legacy_played: true,
      is_cedh_played: true,
      format_play: {
        LE: { main_pct: 5, reason: "5.0% of 2,564 decks" },
        cEDH: { side_pct: 4, side_pct_2w: 9, reason: "commander in 4.0% of 2,596 decks" },
      },
    }} />);
    expect(screen.getByTestId("mtg-format-badge-LE").getAttribute("title")).toContain("mtgLabel.trendGone");
    expect(screen.getByTestId("mtg-format-badge-cEDH").getAttribute("title")).toContain("mtgLabel.trendUpCommander:9");
  });

  it("counts a format label as a label", () => {
    expect(hasAnyMtgLabel({ is_legacy_played: true })).toBe(true);
    expect(hasAnyMtgLabel({ is_reserved: true })).toBe(false);
  });

  it("filters a format chip on its own column", () => {
    expect(mtgTagSelectionQueryFilter(new Set(["modernPlayed"]))).toEqual({ equalsTrue: ["is_modern_played"], anyOfTrue: [] });
    expect(mtgTagSelectionQueryFilter(new Set(["standardPlayed", "cedhPlayed"])).anyOfTrue)
      .toEqual(["is_standard_played", "is_cedh_played"]);
  });
});
