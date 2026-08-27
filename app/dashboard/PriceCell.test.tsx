// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "./LanguageContext";
import { CurrencyProvider } from "./CurrencyContext";
import { PriceCell } from "./columns";
import type { PriceEntry } from "./use-card-data";

// CurrencyProvider only reaches Supabase once a display currency is chosen;
// the default ("none") never does, but the client module still needs to load.
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

function entry(overrides: Partial<PriceEntry> = {}): PriceEntry {
  return {
    price: 21.12,
    symbol: "$",
    currencyCode: "USD",
    normalizedPrice: 21.12,
    locationName: "collectr",
    marketRegion: "NA",
    ...overrides,
  };
}

function renderCell(e: PriceEntry | null) {
  return render(
    <LanguageProvider>
      <CurrencyProvider>
        <PriceCell entry={e} />
      </CurrencyProvider>
    </LanguageProvider>,
  );
}

afterEach(cleanup);

describe("PriceCell price-kind marker", () => {
  it("labels an estimate so a guess is never read as evidence", () => {
    renderCell(entry({ kind: "valuation" }));
    const marker = screen.getByText("est.");
    expect(marker.getAttribute("title")).toMatch(/estimate/i);
    expect(screen.getByText("$21.12")).toBeTruthy();
    expect(screen.getByText("collectr")).toBeTruthy();
    expect(screen.getByText("NA")).toBeTruthy();
  });

  it("labels a completed sale and a shop's offer", () => {
    renderCell(entry({ kind: "sold", locationName: "tcgplayer" }));
    expect(screen.getByText("sold").getAttribute("title")).toMatch(/completed sales/i);
    cleanup();
    renderCell(entry({ kind: "bid", locationName: "expedition_gaming" }));
    expect(screen.getByText("offer").getAttribute("title")).toMatch(/offer to buy/i);
  });

  it("shows no marker for an ask or for an entry that carries no kind", () => {
    renderCell(entry({ kind: "ask", locationName: "cardrush", marketRegion: "JP" }));
    for (const word of ["sold", "offer", "est."]) {
      expect(screen.queryByText(word)).toBeNull();
    }
    cleanup();
    renderCell(entry());
    for (const word of ["sold", "offer", "est."]) {
      expect(screen.queryByText(word)).toBeNull();
    }
  });

  it("renders a dash for a missing side", () => {
    renderCell(null);
    expect(screen.getByText("—")).toBeTruthy();
  });
});
