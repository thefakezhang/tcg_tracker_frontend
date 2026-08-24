// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JapanExclusiveEvidence } from "./JapanExclusiveEvidence";

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

describe("JapanExclusiveEvidence", () => {
  it("renders independent reasons and links when a printing has both categories", () => {
    render(<JapanExclusiveEvidence card={{
      japan_exclusive_artwork: true,
      japan_exclusive_artwork_reason: "Artwork was not released outside Japan.",
      japan_exclusive_artwork_evidence_url: "https://example.test/artwork",
      japan_exclusive_stamps: true,
      japan_exclusive_stamps_reason: "Campaign logo appears only on the Japanese printing.",
      japan_exclusive_stamps_evidence_url: "https://example.test/stamp",
    }} />);

    const artwork = screen.getByTestId("japan-exclusive-artwork");
    const stamps = screen.getByTestId("japan-exclusive-stamps");
    expect(artwork.getAttribute("href")).toBe("https://example.test/artwork");
    expect(stamps.getAttribute("href")).toBe("https://example.test/stamp");
    expect(artwork.textContent).toContain("Artwork was not released outside Japan.");
    expect(stamps.textContent).toContain("Campaign logo appears only on the Japanese printing.");
    expect(artwork.className).toContain("min-h-11");
    expect(stamps.className).toContain("min-h-11");
    artwork.focus();
    expect(document.activeElement).toBe(artwork);
    stamps.focus();
    expect(document.activeElement).toBe(stamps);
  });

  it("renders nothing for a legacy-only or unclassified card", () => {
    const { container } = render(<JapanExclusiveEvidence card={{}} />);
    expect(container.textContent).toBe("");
  });
});
