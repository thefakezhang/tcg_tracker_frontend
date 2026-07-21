// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import StoreSightingAction from "./StoreSightingAction";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StoreSightingAction", () => {
  it("records the store price and immutable evidence snapshot", async () => {
    mocks.rpc.mockResolvedValue({ data: 7, error: null });
    render(
      <StoreSightingAction
        cardId={42}
        psaGrade={10}
        signalsSnapshot={{ signal: { tier: "tier_2" } }}
        defaultPrice="12000"
        defaultCurrency="JPY"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "decision.recordStorePrice" }));
    fireEvent.change(screen.getByLabelText("decision.storeName"), { target: { value: "Card shop A" } });
    fireEvent.change(screen.getByLabelText("decision.observedPrice"), { target: { value: "11500" } });
    fireEvent.change(screen.getByLabelText("decision.sightingNote"), { target: { value: "Near the station" } });
    fireEvent.click(screen.getByRole("button", { name: "decision.saveSighting" }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(
      "record_deal_store_sighting",
      expect.objectContaining({
        p_card_id: 42,
        p_psa_grade: 10,
        p_store_name: "Card shop A",
        p_observed_price: 11500,
        p_currency: "JPY",
        p_signals_snapshot: { signal: { tier: "tier_2" } },
        p_note: "Near the station",
      }),
    ));
    expect(screen.getByText("decision.sightingSaved")).toBeTruthy();
  });
});
