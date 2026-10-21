// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { UnresolvedBuylistObservationRow } from "@/lib/unresolved-buylist-observations";
import { LanguageProvider } from "./LanguageContext";
import { UnresolvedObservationCard } from "./UnresolvedPriceObservationsPanel";

const row: UnresolvedBuylistObservationRow = {
  routingOutcomeId: 9,
  observationOrdinal: 1,
  routedAt: "2026-10-20T14:00:00Z",
  tweetId: "tweet-9",
  buyerHandle: "shop",
  twitterHandle: "shop_cards",
  tweetUrl: "https://x.example/shop/status/tweet-9",
  sourceImageIndex: 0,
  sourceImageUrl: "https://images.example/sheet.jpg",
  sourceContentSha256: "a".repeat(64),
  policyVersion: "fixture:outcome-v2",
  schemaVersion: 1,
  sourceCellIndex: 21,
  sourceImageWidth: 300,
  sourceImageHeight: 200,
  productKind: "singles",
  grade: { status: "not_observed", value: null },
  variant: null,
  sourceGeometry: {
    card: { x0: 90, y0: 0, x1: 170, y1: 120 },
    price: { x0: 90, y0: 120, x1: 170, y1: 140 },
  },
  effectiveGeometry: {
    card: { x0: 91, y0: 0, x1: 171, y1: 120 },
    price: { x0: 91, y0: 120, x1: 171, y1: 140 },
  },
  prices: [
    {
      amountJpy: 110000,
      tier: "item",
      sourceBox: { x0: 90, y0: 120, x1: 170, y1: 140 },
      effectiveBox: { x0: 91, y0: 120, x1: 171, y1: 140 },
      method: "currency_marker",
      ocrConfidence: 0.94,
    },
    {
      amountJpy: 74000,
      tier: "cash",
      sourceBox: { x0: 90, y0: 145, x1: 170, y1: 165 },
      effectiveBox: { x0: 91, y0: 145, x1: 171, y1: 165 },
      method: "grouped_number",
      ocrConfidence: 0.91,
    },
  ],
};

afterEach(cleanup);

describe("unresolved priced observation evidence card", () => {
  it("shows every price tier, grade absence, geometry and financial exclusion", () => {
    const { container } = render(
      <LanguageProvider defaultLanguage="en">
        <UnresolvedObservationCard row={row} />
      </LanguageProvider>,
    );

    expect(screen.getByText("Unknown identity")).toBeTruthy();
    expect(screen.getByText(/Grade not observed/)).toBeTruthy();
    expect(screen.getByText("¥110,000")).toBeTruthy();
    expect(screen.getByText("¥74,000")).toBeTruthy();
    expect(screen.getByText("item")).toBeTruthy();
    expect(screen.getByText("cash")).toBeTruthy();
    expect(screen.getByText(/Verified association: currency_marker/)).toBeTruthy();
    expect(screen.getByText(/OCR 94%/)).toBeTruthy();
    expect(screen.getByText(/Source SHA-256: a{64}/)).toBeTruthy();
    expect(screen.getByText(/Routing outcome 9, observation 1/)).toBeTruthy();
    expect(screen.getByRole("img", { name: "Detected item" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Detected price" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Excluded from every automatic financial and alert path");
    expect(screen.getByText(/\[90, 0, 170, 120\].*\[91, 0, 171, 120\]/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open source post" }).className).toContain("min-h-11");
    expect(container.firstElementChild?.className).toContain("overflow-hidden");
  });

  it("renders source-observed PSA grade without requiring it for raw observations", () => {
    render(
      <LanguageProvider defaultLanguage="en">
        <UnresolvedObservationCard
          row={{ ...row, grade: { status: "observed", value: "psa_10" } }}
        />
      </LanguageProvider>,
    );

    expect(screen.getByText(/Observed grade: psa_10/)).toBeTruthy();
  });
});
