// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JapanExclusiveMasterListDownload } from "./JapanExclusiveMasterListDownload";

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("Japanese exclusivity master list download", () => {
  it("publishes the generated 383-row buyer-readable CSV", () => {
    const csv = readFileSync(
      resolve(process.cwd(), "public/pokemon-japan-exclusives-master-list.csv"),
      "utf8",
    );
    const lines = csv.trimEnd().split("\n");
    expect(lines).toHaveLength(384);
    expect(lines[0]).toBe(
      "era,release_date,set_name,set_code,card_number,edition,variant,language,japanese_name,english_name,category,artwork_reason,artwork_evidence_urls,stamps_reason,stamps_evidence_urls,canonical_image_url,card_uid",
    );
  });

  it("renders a named download link to that artifact", () => {
    render(<JapanExclusiveMasterListDownload />);
    const link = screen.getByTestId("japan-exclusive-master-list-download");
    expect(link.getAttribute("href")).toBe("/pokemon-japan-exclusives-master-list.csv");
    expect(link.getAttribute("download")).toBe("pokemon-japan-exclusives-master-list.csv");
    expect(screen.getByTestId("japan-exclusive-corpus-scope").textContent).toBe(
      "cardBrowser.jpExclusiveCorpusScope",
    );
  });
});
