// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc, from }) }));
vi.mock("./TripContext", () => ({ useTrips: () => ({ activeTripId: 9, trips: [] }) }));

import { OrderListingAction } from "./OrderListingAction";

afterEach(cleanup);

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  from.mockImplementation(() => ({
    select: () => ({ in: () => ({ order: () => Promise.resolve({
      data: [{ plan_id: 5, name: "October scouting", status: "draft", trip_id: 9 }], error: null }) }) }),
  }));
});

function open(props: Partial<React.ComponentProps<typeof OrderListingAction>> = {}) {
  render(
    <OrderListingAction
      cardId={803169}
      cardName="Acerola's Mischief"
      source="shinsoku"
      price={2480}
      currencySymbol="¥"
      {...props}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Add Acerola's Mischief from shinsoku/ }));
}

describe("OrderListingAction", () => {
  // The whole point: the order carries the shop the operator was looking at,
  // not a re-derived cheapest that may be a different shop by then.
  it("orders the listing that was on screen", async () => {
    rpc.mockResolvedValue({ data: [{ card_id: 803169, added: true, source: "shinsoku", asking_price: 2480, available_quantity: 12, reason: null }], error: null });
    open({ availableQuantity: 12 });
    await screen.findByText("Plan");

    fireEvent.change(screen.getByLabelText("Copies"), { target: { value: "3" } });
    fireEvent.click(screen.getByText("Add 3"));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("add_cards_to_purchase_plan", {
        p_plan_id: 5,
        p_items: [{ card_id: 803169, quantity: 3, source: "shinsoku" }],
      }),
    );
  });

  // Depth is the reason it was captured: an over-ask has to be visible while
  // choosing, not discovered by the buyer standing in the shop.
  it("warns before ordering more than the shop holds", async () => {
    open({ availableQuantity: 3 });
    await screen.findByText("Plan");

    fireEvent.change(screen.getByLabelText("Copies"), { target: { value: "20" } });

    expect(screen.getByText(/shinsoku has 3 of 20/)).toBeTruthy();
  });

  // Unknown depth is not zero. A shop that publishes no count still has the
  // card, so guessing would flag every source we have not taught to read stock.
  it("stays quiet when the shop publishes no count", async () => {
    open({ availableQuantity: null });
    await screen.findByText("Plan");

    fireEvent.change(screen.getByLabelText("Copies"), { target: { value: "20" } });

    expect(screen.queryByText(/of 20/)).toBeNull();
  });

  // A refusal names the shop. The operator chose it, so a silent substitution
  // would read as success.
  it("surfaces a refusal instead of looking like it worked", async () => {
    rpc.mockResolvedValue({ data: [{ card_id: 803169, added: false, source: null, asking_price: null, available_quantity: null, reason: "shinsoku has no JPY listing on file" }], error: null });
    open();
    await screen.findByText("Plan");
    fireEvent.click(screen.getByText("Add 1"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("shinsoku has no JPY listing on file");
  });

  it("shows the price and depth being ordered against", async () => {
    open({ availableQuantity: 12 });
    await screen.findByText("Plan");

    expect(screen.getByText(/¥2,480/)).toBeTruthy();
    expect(screen.getByText(/12 in stock/)).toBeTruthy();
  });
});
