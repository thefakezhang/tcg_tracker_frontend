// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CardBrowser from "./CardBrowser";

const mocks = vi.hoisted(() => ({ useCardData: vi.fn(), refetch: vi.fn() }));
const translate = (key: string, values?: { message?: string }) =>
  values?.message ? `${key}: ${values.message}` : key;

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
  useAvailableCardSources: () => ["expedition_gaming"],
  useCardData: mocks.useCardData,
  getCardDisplayName: () => "Card",
}));
vi.mock("./columns", () => ({
  createColumns: () => [], createMtgColumns: () => [], selectColumn: {}, PriceCell: () => null,
}));
vi.mock("./data-table", () => ({
  DataTable: ({ viewMode, data, renderGridItem, sorting }: { viewMode: "list" | "grid"; data: unknown[]; renderGridItem: (row: unknown) => React.ReactNode; sorting: { id: string; desc: boolean }[] }) => (
    <div data-testid="browse-table" data-count={data.length} data-view-mode={viewMode} data-sort={`${sorting[0]?.id}:${sorting[0]?.desc ? "desc" : "asc"}`}>
      browse table
      {viewMode === "grid" ? data.map((row, index) => <div key={index}>{renderGridItem(row)}</div>) : null}
    </div>
  ),
}));
vi.mock("./DecisionActions", () => ({ DecisionActions: () => <div><button>decision.watch</button><button aria-label="decision.dismissOpportunity" /></div> }));
vi.mock("./opportunity-exposures", () => ({ browserOpportunityPayloads: () => [], recordOpportunityExposures: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./DecisionWatchlist", () => ({ default: () => <div>watchlist surface</div> }));
vi.mock("./RefreshPricesAction", () => ({ RefreshPricesAction: () => null }));
vi.mock("./RefreshInFlightStrip", () => ({ RefreshInFlightStrip: () => null }));
vi.mock("./CardDetailModal", () => ({
  default: ({ card, open, onClose }: { card: { card: { card_id: string } } | null; open: boolean; onClose: () => void }) => open ? (
    <div role="dialog" aria-label="card detail">
      <span>{card?.card.card_id}</span>
      <button type="button" onClick={onClose}>close detail</button>
    </div>
  ) : null,
}));
vi.mock("./owned-inventory", () => ({
  ownedInventoryKey: ({ game, cardId }: { game: string; cardId?: string | number | null }) =>
    `${game}:${cardId ?? ""}`,
  useOwnedInventoryCounts: () => new Map(),
}));
// The observation lookup builds a Supabase client on mount; this suite has no
// Supabase env, so stub it like the owned-count hook above.
vi.mock("./card-observations", () => ({ useCardObservations: () => new Map() }));

afterEach(cleanup);

beforeEach(() => {
  mocks.refetch.mockReset();
  mocks.useCardData.mockReturnValue({
    data: [{
      key: "42:10",
      card: { card_id: "42", regional_name: "Card", set_code: "SV-P", card_number: "124", misc_info: null, image_url: null },
      psaGrade: 10,
      prices: { highestBuy: null, lowestSell: null },
      roi: null,
      signal: null,
    }], loading: false, error: null, availableTiers: [1], totalCount: 1,
    refetch: mocks.refetch, refresh: vi.fn(),
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
});

describe("CardBrowser surfaces", () => {
  it("defaults the opportunity display to highest ROI first", () => {
    render(<CardBrowser />);

    expect(screen.getByTestId("browse-table").getAttribute("data-sort")).toBe("roi:desc");
  });

  it("switches from Browse to Watchlist without changing the hook count", () => {
    render(<CardBrowser />);
    expect(screen.getByText("browse table")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "decision.watchlist" }));

    expect(screen.getByText("watchlist surface")).toBeTruthy();
  });

  it("defaults phones to the grid with Watch and optional Dismiss on every card", async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);

    render(<CardBrowser />);

    await waitFor(() => expect(screen.getByTestId("browse-table").getAttribute("data-view-mode")).toBe("grid"));
    expect(screen.getByText("124/SV-P")).toBeTruthy();
    expect(screen.getByRole("button", { name: "decision.watch" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "decision.dismissOpportunity" })).toBeTruthy();
  });

  it.each(["pointer", "Enter", "Space"])("opens phone card details with %s activation", async (activation) => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    render(<CardBrowser />);

    await waitFor(() => expect(screen.getByTestId("browse-table").getAttribute("data-view-mode")).toBe("grid"));
    const card = screen.getByRole("button", { name: "cardBrowser.openDetails" });
    expect(card.getAttribute("tabindex")).toBe("0");
    if (activation === "pointer") fireEvent.click(card);
    else fireEvent.keyDown(card, { key: activation === "Space" ? " " : activation });

    expect(screen.getByRole("dialog", { name: "card detail" })).toBeTruthy();
  });

  it("does not open phone card details from a nested decision control key press", async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    render(<CardBrowser />);

    await waitFor(() => expect(screen.getByTestId("browse-table").getAttribute("data-view-mode")).toBe("grid"));
    fireEvent.keyDown(screen.getByRole("button", { name: "decision.watch" }), { key: "Enter" });

    expect(screen.queryByRole("dialog", { name: "card detail" })).toBeNull();
  });

  it("uses one labeled search column on phones", () => {
    render(<CardBrowser />);

    expect(screen.getByText("cardBrowser.nameLabel")).toBeTruthy();
    expect(screen.getByText("cardBrowser.cardNumberLabel")).toBeTruthy();
    expect(screen.getByText("cardBrowser.setCodeLabel")).toBeTruthy();
    expect(screen.getByTestId("browser-search-grid").className).toContain("grid-cols-1");
  });

  it("keeps price filters full-width on phones and names the refresh action", () => {
    render(<CardBrowser />);

    const priceFilters = screen.getByTestId("browser-price-filters");
    expect(priceFilters.className).toContain("w-full");
    expect(priceFilters.className).toContain("grid-cols-1");
    expect(priceFilters.className).toContain("sm:grid-cols-2");
    expect(priceFilters.className).toContain("xl:grid-cols-4");
    for (const label of [
      "cardBrowser.minBuyPrice",
      "cardBrowser.minSellPrice",
      "cardBrowser.roiFloor",
      "cardBrowser.roiCeiling",
    ]) {
      expect(screen.getByRole("spinbutton", { name: label }).className).toContain("w-full");
    }

    const refresh = screen.getByRole("button", { name: "refresh.confirm" });
    expect(refresh.getAttribute("title")).toBe("refresh.confirm");
  });

  it("retains results and offers an accessible retry when external-id lookup fails", () => {
    mocks.useCardData.mockReturnValue({
      data: [{
        key: "42:10",
        card: { card_id: "42", regional_name: "Card", set_code: "SV-P", card_number: "124", misc_info: null, image_url: null },
        psaGrade: 10,
        prices: { highestBuy: null, lowestSell: null },
        roi: null,
        signal: null,
      }],
      loading: false,
      error: {
        name: "ExternalIdentifierLookupError",
        code: "external_identifier_lookup_failed",
        message: "External identifier lookup is temporarily unavailable.",
      },
      availableTiers: [1],
      totalCount: 1,
      refetch: mocks.refetch,
      refresh: vi.fn(),
    });

    render(<CardBrowser />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("common.externalIdentifierLookupError");
    expect(alert.textContent).toContain("common.externalIdentifierLookupHelp");
    expect(document.body.textContent).not.toContain("permission denied");
    expect(screen.getByTestId("browse-table").getAttribute("data-count")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
