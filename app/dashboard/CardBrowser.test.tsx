// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CardBrowser from "./CardBrowser";

const translate = (key: string) => key;

vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("./LanguageContext", () => ({ useLanguage: () => ({ language: "en" }) }));
vi.mock("./GameContext", () => ({
  useGame: () => ({ activeGame: "pokemon", psaMode: "psa", setPsaMode: vi.fn() }),
}));
vi.mock("./ExitBasisContext", () => ({
  useExitBasis: () => ({ exitPercentile: "p25", setExitPercentile: vi.fn() }),
}));
vi.mock("./HeaderContext", () => ({ useHeader: () => ({ setHeaderActions: vi.fn() }) }));
vi.mock("./use-card-data", () => ({
  useCardData: () => ({
    data: [], loading: false, error: null, availableTiers: [1], totalCount: 0,
    refetch: vi.fn(), refresh: vi.fn(),
  }),
  getCardDisplayName: () => "Card",
}));
vi.mock("./columns", () => ({
  createColumns: () => [], createMtgColumns: () => [], selectColumn: {}, PriceCell: () => null,
}));
vi.mock("./data-table", () => ({ DataTable: () => <div>browse table</div> }));
vi.mock("./DecisionWatchlist", () => ({ default: () => <div>watchlist surface</div> }));
vi.mock("./RefreshPricesAction", () => ({ RefreshPricesAction: () => null }));
vi.mock("./RefreshInFlightStrip", () => ({ RefreshInFlightStrip: () => null }));
vi.mock("./CardDetailModal", () => ({ default: () => null }));

afterEach(cleanup);

describe("CardBrowser surfaces", () => {
  it("switches from Browse to Watchlist without changing the hook count", () => {
    render(<CardBrowser />);
    expect(screen.getByText("browse table")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "decision.watchlist" }));

    expect(screen.getByText("watchlist surface")).toBeTruthy();
  });
});
