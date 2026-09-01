// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc, from }) }));
vi.mock("./TripContext", () => ({ useTrips: () => ({ activeTripId: 9, trips: [] }) }));

import { AddToPlanAction } from "./AddToPlanAction";

afterEach(cleanup);

function plansResult(rows: unknown[]) {
  return {
    select: () => ({ in: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }),
  };
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  from.mockImplementation(() => plansResult([
    { plan_id: 5, name: "October scouting", status: "draft", trip_id: 9 },
    { plan_id: 7, name: "Other trip plan", status: "draft", trip_id: 3 },
  ]));
});

describe("AddToPlanAction", () => {
  it("does not appear until cards are selected", () => {
    const { container } = render(<AddToPlanAction cardIds={[]} />);
    expect(container.textContent).toBe("");
  });

  it("defaults to a plan on the active trip", async () => {
    // With many trips the plan list gets long; landing on the current trip's
    // plan is the difference between one click and hunting.
    render(<AddToPlanAction cardIds={[1, 2]} />);
    fireEvent.click(screen.getByText("Add to plan"));
    await waitFor(() => {
      const select = document.querySelector("select") as HTMLSelectElement;
      expect(select.value).toBe("5");
    });
  });

  it("sends the selected cards, quantity and ceiling", async () => {
    rpc.mockResolvedValue({ data: [{ card_id: 1, added: true, source: "cardrush", asking_price: 900, reason: null }], error: null });
    render(<AddToPlanAction cardIds={[1, 2]} />);
    fireEvent.click(screen.getByText("Add to plan"));
    await screen.findByText("Plan");

    fireEvent.change(screen.getByLabelText(/Copies wanted/), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText(/Max price/), { target: { value: "2500" } });
    fireEvent.click(screen.getByText("Add 2"));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("add_cards_to_purchase_plan", expect.objectContaining({
        p_plan_id: 5, p_card_ids: [1, 2], p_quantity: 3, p_ceiling_jpy: 2500,
      })),
    );
  });

  it("shows which cards were not added, and why", async () => {
    // A partial success the operator cannot see is worse than a slow dialog:
    // a card would be believed on the list when it is not.
    rpc.mockResolvedValue({
      data: [
        { card_id: 1, added: true, source: "cardrush", asking_price: 900, reason: null },
        { card_id: 2, added: false, source: null, asking_price: null, reason: "no JPY listing on file" },
      ],
      error: null,
    });
    render(<AddToPlanAction cardIds={[1, 2]} />);
    fireEvent.click(screen.getByText("Add to plan"));
    await screen.findByText("Plan");
    fireEvent.click(screen.getByText("Add 2"));

    await screen.findByText("Added 1 of 2");
    expect(screen.getByText(/no JPY listing on file/)).toBeTruthy();
  });

  it("surfaces a refusal rather than failing silently", async () => {
    rpc.mockResolvedValue({ error: { message: "purchase plan 5 is ordered, so lines cannot be added" } });
    render(<AddToPlanAction cardIds={[1]} />);
    fireEvent.click(screen.getByText("Add to plan"));
    await screen.findByText("Plan");
    fireEvent.click(screen.getByText("Add 1"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("ordered");
  });
});
