// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    data: [{
      key: "42:10",
      card: { card_id: "42", regional_name: "Card", set_code: "M6", card_number: "001", misc_info: null, image_url: null },
      psaGrade: 10,
      prices: { highestBuy: null, lowestSell: null },
      roi: null,
      signal: null,
    }], loading: false, error: null, availableTiers: [1], totalCount: 1,
    refetch: vi.fn(), refresh: vi.fn(),
  }),
  getCardDisplayName: () => "Card",
}));
vi.mock("./columns", () => ({
  createColumns: () => [], createMtgColumns: () => [], selectColumn: {}, PriceCell: () => null,
}));
vi.mock("./data-table", () => ({
  DataTable: ({ viewMode, data, renderGridItem }: { viewMode: "list" | "grid"; data: unknown[]; renderGridItem: (row: unknown) => React.ReactNode }) => (
    <div data-testid="browse-table" data-view-mode={viewMode}>
      browse table
      {viewMode === "grid" ? data.map((row, index) => <div key={index}>{renderGridItem(row)}</div>) : null}
    </div>
  ),
}));
vi.mock("./DecisionActions", () => ({ DecisionActions: () => <div><button>decision.pass</button><button>decision.watch</button></div> }));
vi.mock("./DecisionWatchlist", () => ({ default: () => <div>watchlist surface</div> }));
vi.mock("./RefreshPricesAction", () => ({ RefreshPricesAction: () => null }));
vi.mock("./RefreshInFlightStrip", () => ({ RefreshInFlightStrip: () => null }));
vi.mock("./CardDetailModal", () => ({ default: () => null }));

afterEach(cleanup);

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
});

describe("CardBrowser surfaces", () => {
  it("switches from Browse to Watchlist without changing the hook count", () => {
    render(<CardBrowser />);
    expect(screen.getByText("browse table")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "decision.watchlist" }));

    expect(screen.getByText("watchlist surface")).toBeTruthy();
  });

  it("defaults phones to the grid with decision actions on every card", async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);

    render(<CardBrowser />);

    await waitFor(() => expect(screen.getByTestId("browse-table").getAttribute("data-view-mode")).toBe("grid"));
    expect(screen.getByRole("button", { name: "decision.pass" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "decision.watch" })).toBeTruthy();
  });
});
