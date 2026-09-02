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
    const { container } = render(<AddToPlanAction cards={[]} />);
    expect(container.textContent).toBe("");
  });

  it("defaults to a plan on the active trip", async () => {
    // With many trips the plan list gets long; landing on the current trip's
    // plan is the difference between one click and hunting.
    render(<AddToPlanAction cards={[{ id: 1, name: "Iono" }, { id: 2, name: "Bede" }]} />);
    fireEvent.click(screen.getByText("Add to plan"));
    await waitFor(() => {
      const select = document.querySelector("select") as HTMLSelectElement;
      expect(select.value).toBe("5");
    });
  });

  it("gives every card its own quantity and ceiling", async () => {
    // One number for a whole selection is wrong for every card but the one it
    // was chosen for: a bulk common wanted twenty deep sits next to a chase card.
    rpc.mockResolvedValue({ data: [{ card_id: 1, added: true, source: "cardrush", asking_price: 900, reason: null }], error: null });
    render(<AddToPlanAction cards={[{ id: 1, name: "Iono" }, { id: 2, name: "Bede" }]} />);
    fireEvent.click(screen.getByText("Add to plan"));
    await screen.findByText("Plan");

    fireEvent.change(screen.getByLabelText("Copies of Iono"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Max price for Iono"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Copies of Bede"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Max price for Bede"), { target: { value: "60000" } });
    fireEvent.click(screen.getByText(/^Add 21 copies$/));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("add_cards_to_purchase_plan", {
        p_plan_id: 5,
        p_items: [
          { card_id: 1, quantity: 20, ceiling_jpy: 500 },
          { card_id: 2, quantity: 1, ceiling_jpy: 60000 },
        ],
      }),
    );
  });

  it("names each card, since a quantity cannot be answered for an id", async () => {
    render(<AddToPlanAction cards={[{ id: 803169, name: "Acerola's Mischief" }]} />);
    fireEvent.click(screen.getByText("Add to plan"));
    await screen.findByText("Plan");

    expect(screen.getByText("Acerola's Mischief")).toBeTruthy();
    expect(screen.getByLabelText("Copies of Acerola's Mischief")).toBeTruthy();
  });

  it("seeds every row from the bulk default only when applied", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    render(<AddToPlanAction cards={[{ id: 1, name: "Iono" }, { id: 2, name: "Bede" }]} />);
    fireEvent.click(screen.getByText("Add to plan"));
    await screen.findByText("Plan");

    fireEvent.change(screen.getByLabelText("Copies"), { target: { value: "4" } });
    // Nothing changes behind the operator's back until Apply is pressed.
    expect((screen.getByLabelText("Copies of Iono") as HTMLInputElement).value).toBe("1");

    fireEvent.click(screen.getByText("Apply to all"));

    expect((screen.getByLabelText("Copies of Iono") as HTMLInputElement).value).toBe("4");
    expect((screen.getByLabelText("Copies of Bede") as HTMLInputElement).value).toBe("4");
  });

  it("defaults a card with no ceiling to no cap rather than zero", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    render(<AddToPlanAction cards={[{ id: 1, name: "Iono" }]} />);
    fireEvent.click(screen.getByText("Add to plan"));
    await screen.findByText("Plan");
    fireEvent.click(screen.getByText(/^Add 1 copy$/));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("add_cards_to_purchase_plan", {
        p_plan_id: 5,
        p_items: [{ card_id: 1, quantity: 1, ceiling_jpy: null }],
      }),
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
    render(<AddToPlanAction cards={[{ id: 1, name: "Iono" }, { id: 2, name: "Bede" }]} />);
    fireEvent.click(screen.getByText("Add to plan"));
    await screen.findByText("Plan");
    fireEvent.click(screen.getByText(/^Add 2 copies$/));

    await screen.findByText("Added 1 of 2");
    expect(screen.getByText(/Bede - no JPY listing on file/)).toBeTruthy();
  });

  it("surfaces a refusal rather than failing silently", async () => {
    rpc.mockResolvedValue({ error: { message: "purchase plan 5 is ordered, so lines cannot be added" } });
    render(<AddToPlanAction cards={[{ id: 1, name: "Iono" }]} />);
    fireEvent.click(screen.getByText("Add to plan"));
    await screen.findByText("Plan");
    fireEvent.click(screen.getByText(/^Add 1 copy$/));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("ordered");
  });
});
