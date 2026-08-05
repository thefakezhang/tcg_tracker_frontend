// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "./LanguageContext";
import InventoryView from "./InventoryView";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  retry: vi.fn(),
  bumpOwnedInventory: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));

vi.mock("./owned-inventory", () => ({
  bumpOwnedInventory: mocks.bumpOwnedInventory,
}));

vi.mock("./TheoreticalRoiSummary", () => ({ default: () => null }));

vi.mock("./use-query", () => ({
  QueryError: () => null,
  useSupabaseQuery: () => ({
    data: {
      holdings: [{
        game: "pokemon",
        item_type: "single",
        leg: "import",
        card_id: 5,
        product_id: null,
        name: "リザードン",
        set_code: "SV3",
        card_number: "134/108",
        misc_info: null,
        condition_id: 2,
        psa_grade: 0,
        sealed_condition: null,
        variant_edition: null,
        qty_on_hand: 5,
        avg_cost_usd: 15,
        total_cost_usd: 75,
        imageUrl: null,
        englishName: "Charizard",
        uid: "abc12345",
        reprintEvents: [],
      }],
      roiLines: [{
        line_key: "pokemon:1",
        lot_line_id: 1,
        lot_id: 42,
        trip_id: 7,
        shop_label: "Tokyo Cards",
        acquired_at: "2026-08-01",
        leg: "import",
        game: "pokemon",
        item_type: "single",
        card_id: 5,
        product_id: null,
        condition_id: 2,
        psa_grade: 0,
        sealed_condition: null,
        variant_edition: null,
        qty_on_hand: 5,
        consigned_qty: 2,
        on_hand_cost_usd: 75,
        exit_unit_usd: null,
        net_pct: null,
        exit_net_usd: null,
        theoretical_profit_usd: null,
        theoretical_roi_pct: null,
        days_held: 4,
        annualized_roi_pct: null,
        below_cost: null,
        age_bucket: "0-30d",
        priced: false,
      }],
    },
    error: undefined,
    isLoading: false,
    retry: mocks.retry,
  }),
}));

beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ data: 3, error: null });
  mocks.retry.mockReset().mockResolvedValue(undefined);
  mocks.bumpOwnedInventory.mockReset();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
});

afterEach(cleanup);

describe("InventoryView consignment management", () => {
  it("shows exact stock counts and saves the selected source line", async () => {
    render(
      <LanguageProvider>
        <InventoryView />
      </LanguageProvider>,
    );

    expect(screen.getByText("5 cards on hand")).toBeTruthy();
    expect(screen.getByText("2 consigned")).toBeTruthy();
    expect(screen.getByText("3 available")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    fireEvent.change(
      screen.getByLabelText("On consignment for lot #42, line #1"),
      { target: { value: "3" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(
      "set_line_consignment",
      { p_game: "pokemon", p_lot_line_id: 1, p_consigned_qty: 3 },
    ));
    expect(mocks.bumpOwnedInventory).toHaveBeenCalledOnce();
    expect(mocks.retry).toHaveBeenCalledOnce();
  });

  it("defaults a phone viewport to the tappable card workflow", async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);

    render(
      <LanguageProvider>
        <InventoryView />
      </LanguageProvider>,
    );

    const manageCard = await screen.findByRole("button", {
      name: "Manage consignment for Charizard",
    });
    expect(manageCard.className).toContain("focus-visible:ring-3");
  });
});
