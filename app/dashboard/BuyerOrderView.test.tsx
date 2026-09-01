// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc }),
}));

import BuyerOrderView from "./BuyerOrderView";

afterEach(cleanup);

const plan = {
  plan_id: 7, name: "August trip", status: "ordered",
  line_count: 2, recorded_count: 0, finalized: false,
};

function line(id: number, source: string) {
  return {
    plan_line_id: id, source, source_listing_url: `https://shop.test/${id}`,
    planned_quantity: 2, unit_price_orig: 1000, currency: "JPY",
    source_observed_at: new Date().toISOString(),
    card_name: "テストカード", card_english_name: "Test Card",
    set_code: "TST", card_number: "001/001", image_url: null,
    want_id: null, want_max: null, want_filled: null, want_ceiling: null,
    outcome: "pending", purchased_quantity: 0, unit_price_jpy: null,
    condition_seen: null, note: null,
  };
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation((fn: string) => {
    if (fn === "buyer_assigned_plans") return Promise.resolve({ data: [plan], error: null });
    if (fn === "buyer_plan_lines") {
      return Promise.resolve({ data: [line(1, "cardrush"), line(2, "hareruya2")], error: null });
    }
    if (fn === "buyer_source_receipts") return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: null, error: null });
  });
});

describe("BuyerOrderView", () => {
  it("groups lines by source, because he checks out one shop at a time", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    expect(screen.getByText("hareruya2")).toBeTruthy();
  });

  it("records a purchase with the quantity and price he typed", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");

    const outcome = document.querySelector<HTMLSelectElement>('[data-cell="1:outcome"]')!;
    fireEvent.change(outcome, { target: { value: "purchased" } });
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("buyer_record_result", expect.objectContaining({
        p_plan_line_id: 1, p_outcome: "purchased",
      })),
    );

    const price = document.querySelector<HTMLInputElement>('[data-cell="1:price"]')!;
    fireEvent.change(price, { target: { value: "1450" } });
    fireEvent.blur(price);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("buyer_record_result", expect.objectContaining({
        p_plan_line_id: 1, p_unit_price_jpy: 1450,
      })),
    );
  });

  it("moves DOWN the column on Enter, the way a spreadsheet does", async () => {
    // The whole point of the grid is that an Excel user never reaches for the
    // mouse. Enter must land on the same column of the next row, not the next
    // cell in DOM order.
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");

    const first = document.querySelector<HTMLInputElement>('[data-cell="1:note"]')!;
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });

    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-cell")).toBe("2:note"),
    );
  });

  it("abandons an edit on Escape instead of saving it", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    rpc.mockClear();

    const note = document.querySelector<HTMLInputElement>('[data-cell="1:note"]')!;
    fireEvent.change(note, { target: { value: "typed by mistake" } });
    fireEvent.keyDown(note, { key: "Escape" });
    fireEvent.blur(note);

    await waitFor(() => expect(note.value).toBe(""));
    expect(rpc).not.toHaveBeenCalledWith("buyer_record_result", expect.anything());
  });

  it("restores the row and explains when a save is refused", async () => {
    // A silent drop would be the worst outcome: he would believe a purchase was
    // recorded that never landed, and only discover it at reconciliation.
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");

    rpc.mockImplementation((fn: string) => {
      if (fn === "buyer_record_result") {
        return Promise.resolve({ error: { message: "results are finalized" } });
      }
      return Promise.resolve({ data: [], error: null });
    });

    const outcome = document.querySelector<HTMLSelectElement>('[data-cell="1:outcome"]')!;
    fireEvent.change(outcome, { target: { value: "purchased" } });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("finalized");
    await waitFor(() => expect(outcome.value).toBe("pending"));
  });


  it("shows the card he is buying, not an anonymous row", async () => {
    // He is matching this against a Japanese shop page; without the name he
    // cannot confirm he is buying the right card.
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    expect(screen.getAllByText("テストカード").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/TST/).length).toBeGreaterThan(0);
  });

  it("says the sheet is open for editing", async () => {
    // The grid read as a report; it is a worksheet, and he needs to know his
    // edits are landing.
    render(<BuyerOrderView />);
    await screen.findByText(/Open for editing/);
  });

  it("offers a receipt upload per source", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    // One per shop, because each shop is its own checkout.
    expect(screen.getAllByText(/Upload receipt/).length).toBe(2);
  });

  it("shows the want total across sources when lines share a cap", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "buyer_assigned_plans") return Promise.resolve({ data: [plan], error: null });
      if (fn === "buyer_source_receipts") return Promise.resolve({ data: [], error: null });
      if (fn === "buyer_plan_lines") {
        return Promise.resolve({ data: [
          { ...line(1, "cardrush"), want_id: 9, want_max: 20, want_filled: 14, want_ceiling: 1200 },
          { ...line(2, "hareruya2"), want_id: 9, want_max: 20, want_filled: 14, want_ceiling: 1200 },
        ], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    // Both listings show the SHARED progress, so he can see 6 remain wherever
    // he buys them.
    expect(screen.getAllByText("14/20").length).toBe(2);
  });


  it("marking a line Bought fills the quantity and price so it saves first time", async () => {
    // The database requires a purchase to carry both, but the natural order is
    // to pick the outcome and type the numbers after - so the first save used
    // to be rejected outright. One click now records a complete purchase.
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    rpc.mockClear();

    const outcome = document.querySelector<HTMLSelectElement>('[data-cell="1:outcome"]')!;
    fireEvent.change(outcome, { target: { value: "purchased" } });

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("buyer_record_result", expect.objectContaining({
        p_plan_line_id: 1,
        p_outcome: "purchased",
        p_purchased_quantity: 2,   // the line's planned quantity
        p_unit_price_jpy: 1000,    // the asking price we already knew
      })),
    );
  });

  it("caps the prefilled quantity at what the want still needs", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "buyer_assigned_plans") return Promise.resolve({ data: [plan], error: null });
      if (fn === "buyer_source_receipts") return Promise.resolve({ data: [], error: null });
      if (fn === "buyer_plan_lines") {
        return Promise.resolve({ data: [
          // 20 wanted, 18 already bought elsewhere: this listing should offer 2.
          { ...line(1, "cardrush"), planned_quantity: 20, want_id: 9, want_max: 20, want_filled: 18 },
        ], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    rpc.mockClear();

    fireEvent.change(document.querySelector<HTMLSelectElement>('[data-cell="1:outcome"]')!,
      { target: { value: "purchased" } });

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("buyer_record_result", expect.objectContaining({
        p_purchased_quantity: 2,
      })),
    );
  });

  it("explains the completeness rule in words he can act on", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    rpc.mockImplementation((fn: string) => {
      if (fn === "buyer_record_result") {
        return Promise.resolve({ error: { message: 'violates check constraint "purchase_plan_line_results_purchase_complete"' } });
      }
      return Promise.resolve({ data: [], error: null });
    });
    fireEvent.change(document.querySelector<HTMLSelectElement>('[data-cell="1:outcome"]')!,
      { target: { value: "purchased" } });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("quantity and a price");
  });

  it("locks the grid once the operator has reconciled", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "buyer_assigned_plans") {
        return Promise.resolve({ data: [{ ...plan, finalized: true }], error: null });
      }
      if (fn === "buyer_plan_lines") return Promise.resolve({ data: [line(1, "cardrush")], error: null });
      if (fn === "buyer_source_receipts") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    });
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");

    expect(document.querySelector<HTMLSelectElement>('[data-cell="1:outcome"]')!.disabled).toBe(true);
    expect(screen.getByText(/Closed/)).toBeTruthy();
  });
});
