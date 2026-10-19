// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MtgLabelEvidence } from "./MtgLabelEvidence";

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
});
