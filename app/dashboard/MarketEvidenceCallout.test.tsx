// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketEvidenceBadge, MarketEvidenceCallout } from "./MarketEvidenceCallout";
import { compareMarketEstimates } from "./market-evidence";

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      if (!values) return key;
      return `${key} ${Object.values(values).join(" ")}`;
    },
  }),
}));

afterEach(cleanup);

describe("MarketEvidenceBadge", () => {
  it("labels Collectr-only evidence", () => {
    render(<MarketEvidenceBadge evidence={compareMarketEstimates(81.21, null)} />);
    expect(screen.getByText("marketEvidence.collectrOnlyBadge")).toBeTruthy();
  });

  it("shows the direction and percentage of a discrepancy", () => {
    render(<MarketEvidenceBadge evidence={compareMarketEstimates(75, 100)} />);
    expect(screen.getByText("marketEvidence.discrepancyBelowBadge 25")).toBeTruthy();
  });

  it("stays quiet for aligned estimates", () => {
    const { container } = render(<MarketEvidenceBadge evidence={compareMarketEstimates(110, 100)} />);
    expect(container.textContent).toBe("");
  });
});

describe("MarketEvidenceCallout", () => {
  it("shows both prices and the discrepancy direction", () => {
    render(<MarketEvidenceCallout evidence={compareMarketEstimates(150, 100)} />);
    const callout = screen.getByRole("region", { name: "marketEvidence.label" });
    expect(callout.textContent).toContain("marketEvidence.discrepancyTitle");
    expect(callout.textContent).toContain("marketEvidence.discrepancyAboveBody");
    expect(callout.textContent).toContain("$150");
    expect(callout.textContent).toContain("$100");
    expect(callout.textContent).toContain("50");
  });
});
