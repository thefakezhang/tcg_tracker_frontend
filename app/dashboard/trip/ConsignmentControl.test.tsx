// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../LanguageContext";
import ConsignmentControl from "./ConsignmentControl";

const mocks = vi.hoisted(() => ({
  row: {
    consignee: "Influencer",
    consigned_qty: 0,
    consignment_sold_at: "2026-08-08T00:00:00Z",
    consignment_sold_quantity: 2,
    consignment_sale_usd: 40,
    consignment_fee_usd: 4,
  },
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: mocks.row, error: null }),
        }),
      }),
    }),
    rpc: mocks.rpc,
  }),
}));

beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null });
});

afterEach(cleanup);

describe("ConsignmentControl", () => {
  it("keeps a booked sale visible after consigned quantity reaches zero and confirms reversal", async () => {
    render(
      <LanguageProvider>
        <ConsignmentControl game="pokemon" lineId={17} qtyRemaining={3} />
      </LanguageProvider>,
    );

    expect(await screen.findByText("Sold ×2 for $40.00 (net $36.00)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo sale" }));

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(await screen.findByText(/full accounting reversal/)).toBeTruthy();
    const actions = screen.getAllByRole("button", { name: "Undo sale" });
    fireEvent.click(actions[actions.length - 1]);

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(
      "clear_line_consignment",
      { p_game: "pokemon", p_lot_line_id: 17 },
    ));
  });
});
