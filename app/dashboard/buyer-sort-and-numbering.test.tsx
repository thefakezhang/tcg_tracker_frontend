// @vitest-environment jsdom
//
// He works down a shop one row at a time and needs to be able to say where he
// is, and to bring the expensive ones or the unfilled ones to the top.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));

import BuyerOrderView from "./BuyerOrderView";

afterEach(cleanup);

const plan = {
  plan_id: 7, name: "trip", status: "ordered",
  line_count: 4, recorded_count: 1, finalized: false, handed_back: false,
};

function line(id: number, asking: number, outcome: string) {
  return {
    plan_line_id: id, source: "snkrdunk", source_listing_url: null,
    planned_quantity: 1, unit_price_orig: asking, currency: "JPY",
    source_observed_at: "2026-09-06T00:00:00Z",
    card_name: `card-${id}`, card_english_name: null,
    set_code: "TST", card_number: "001/001", image_url: null,
    want_id: null, want_max: null, want_filled: null, want_ceiling: null,
    outcome, purchased_quantity: outcome === "purchased" ? 1 : 0,
    unit_price_jpy: outcome === "purchased" ? asking : null,
    condition_seen: null, note: null,
  };
}

// Deliberately not in price order, and not in outcome order.
const lines = [
  line(1, 8000, "pending"),
  line(2, 30000, "purchased"),
  line(3, 1980, "sold_out"),
  line(4, 15000, "pending"),
];

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation((fn: string) => {
    if (fn === "buyer_assigned_plans") return Promise.resolve({ data: [plan], error: null });
    if (fn === "buyer_plan_lines") return Promise.resolve({ data: lines, error: null });
    return Promise.resolve({ data: [], error: null });
  });
});

/** The card name in each row, top to bottom. */
const order = () =>
  Array.from(document.querySelectorAll("tbody tr")).map(
    (tr) => tr.querySelector(".truncate.font-medium")?.textContent);

/** The leading counter in each row, top to bottom. */
const numbers = () =>
  Array.from(document.querySelectorAll("tbody tr")).map(
    (tr) => tr.querySelector("td")?.textContent);

const header = (name: string) => screen.getByRole("button", { name: new RegExp(name) });

describe("keeping his place", () => {
  it("numbers the rows down the shop", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    expect(numbers()).toEqual(["1", "2", "3", "4"]);
  });

  it("keeps the numbers reading 1, 2, 3 after a sort", async () => {
    // The counter is his place in the list on screen. If sorting scrambled it
    // he could no longer say "I am on twelve", which is the whole point.
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    fireEvent.click(header("buyer.colAsking"));
    await waitFor(() => expect(order()[0]).toBe("card-3"));
    expect(numbers()).toEqual(["1", "2", "3", "4"]);
  });
});

describe("reordering the shop", () => {
  it("starts in the order the operator built the list", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    expect(order()).toEqual(["card-1", "card-2", "card-3", "card-4"]);
  });

  it("sorts by asking price, cheapest first, then reverses", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("card-1");

    fireEvent.click(header("buyer.colAsking"));
    await waitFor(() => expect(order()).toEqual(["card-3", "card-1", "card-4", "card-2"]));

    fireEvent.click(header("buyer.colAsking"));
    await waitFor(() => expect(order()).toEqual(["card-2", "card-4", "card-1", "card-3"]));
  });

  it("puts the work he has not done first when sorting by result", async () => {
    // Alphabetical on the raw value would be meaningless to him; pending
    // first is the question he is actually asking.
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    fireEvent.click(header("buyer.colResult"));
    await waitFor(() => expect(order().slice(0, 2)).toEqual(["card-1", "card-4"]));
  });

  it("gives the operator's order back on a third click", async () => {
    // That order is itself information - they built the list in it - so it
    // must not be lost the moment he sorts once.
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    const asking = () => header("buyer.colAsking");
    fireEvent.click(asking());
    fireEvent.click(asking());
    fireEvent.click(asking());
    await waitFor(() => expect(order()).toEqual(["card-1", "card-2", "card-3", "card-4"]));
  });

  it("says which way it is sorted, for a screen reader and for him", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    const th = () => header("buyer.colAsking").closest("th") as HTMLElement;
    expect(th().getAttribute("aria-sort")).toBe("none");
    fireEvent.click(header("buyer.colAsking"));
    await waitFor(() => expect(th().getAttribute("aria-sort")).toBe("ascending"));
    fireEvent.click(header("buyer.colAsking"));
    await waitFor(() => expect(th().getAttribute("aria-sort")).toBe("descending"));
  });

  it("marks both columns as reorderable before he thinks to try", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    for (const col of ["buyer.colAsking", "buyer.colResult"]) {
      expect(header(col).textContent).toMatch(/[↑↓⇅]/);
    }
  });

  it("moves the keyboard focus in the order on screen, not the order it arrived", async () => {
    // ctrl-arrow walks `ordered`, which is flattened from the sorted groups -
    // if it walked the raw rows he would jump around the screen.
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    fireEvent.click(header("buyer.colAsking"));
    await waitFor(() => expect(order()[0]).toBe("card-3"));

    const first = document.querySelector<HTMLSelectElement>('[data-cell="3:outcome"]')!;
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown", ctrlKey: true });
    // card-1 at 8,000 is the next row down once sorted by price.
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-cell")).toBe("1:outcome"));
  });
});
