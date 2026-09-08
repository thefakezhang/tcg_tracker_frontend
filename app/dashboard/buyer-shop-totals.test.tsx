// @vitest-environment jsdom
//
// He is standing in a shop with a receipt in his hand. What he needs on that
// screen is what this shop has cost him, what it has earned him, and somewhere
// to put the shipping line off the receipt - all at the grain of the shop,
// because that is the grain he checks out at.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));

import BuyerOrderView, { parseTypedJpy } from "./BuyerOrderView";

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

const totals = [
  {
    source: "cardrush", total_lines: 1, recorded_lines: 1, purchased_lines: 1,
    cards_bought: 3, card_value_jpy: 30000, shipping_jpy: 800,
    other_costs_jpy: 0, spent_total_jpy: 30800, agent_payout_jpy: 1000,
  },
  {
    source: "hareruya2", total_lines: 1, recorded_lines: 0, purchased_lines: 0,
    cards_bought: 0, card_value_jpy: 0, shipping_jpy: 0,
    other_costs_jpy: 0, spent_total_jpy: 0, agent_payout_jpy: 0,
  },
];

function mountRpc(over: { finalized?: boolean } = {}) {
  rpc.mockReset();
  rpc.mockImplementation((fn: string) => {
    if (fn === "buyer_assigned_plans") {
      return Promise.resolve({ data: [{ ...plan, ...over }], error: null });
    }
    if (fn === "buyer_plan_lines") {
      return Promise.resolve({ data: [line(1, "cardrush"), line(2, "hareruya2")], error: null });
    }
    if (fn === "buyer_source_totals") return Promise.resolve({ data: totals, error: null });
    if (fn === "buyer_source_receipts") return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

beforeEach(() => mountRpc());

describe("per-shop totals", () => {
  it("shows what this shop cost and what it earned him, per shop", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    await waitFor(() => expect(screen.getByText("¥30,800")).toBeTruthy());
    // His fee for this shop: 3% of card value + 100/row, computed server-side.
    expect(screen.getByText("¥1,000")).toBeTruthy();
    // The shop he has not touched shows its own zeroes, not the other's money.
    expect(screen.getAllByText("¥0").length).toBeGreaterThan(0);
  });

  it("records shipping against the shop he is checking out of", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    // The button already carries what has been recorded so far - one per shop.
    const openers = await screen.findAllByRole("button", { name: /buyer\.shippingEtc/ });
    expect(openers[0].textContent).toContain("¥800");
    fireEvent.click(openers[0]);

    const amount = screen.getAllByLabelText("buyer.costShipping")[0] as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "1,200" } });
    fireEvent.click(screen.getAllByRole("button", { name: "buyer.saveCost" })[0]);

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("buyer_record_source_cost", {
        p_plan_id: 7, p_source: "cardrush", p_kind: "shipping",
        p_amount_jpy: 1200, p_note: null,
      }),
    );
  });

  it("refuses to save an amount it could not read, rather than sending a NaN", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    await waitFor(() => expect(screen.getAllByRole("button", { name: /buyer\.shippingEtc/ }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("button", { name: /buyer\.shippingEtc/ })[0]);

    const save = screen.getAllByRole("button", { name: "buyer.saveCost" })[0] as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    const amount = screen.getAllByLabelText("buyer.costShipping")[0] as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "-" } });
    expect((screen.getAllByRole("button", { name: "buyer.saveCost" })[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("stops offering the form once the list is finalized, but still shows the figures", async () => {
    mountRpc({ finalized: true });
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    await waitFor(() => expect(screen.getByText("¥30,800")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /buyer\.shippingEtc/ })).toBeNull();
    expect(screen.getByText(/buyer\.shippingEtc ¥800/)).toBeTruthy();
  });
});

describe("parseTypedJpy", () => {
  it("reads a price the way it is written on a receipt", () => {
    expect(parseTypedJpy("1,200")).toBe(1200);
    expect(parseTypedJpy("¥3,699")).toBe(3699);
    expect(parseTypedJpy(" 800 ")).toBe(800);
  });

  it("returns null rather than a NaN that would reach the database as a lost value", () => {
    expect(parseTypedJpy("")).toBeNull();
    expect(parseTypedJpy("-")).toBeNull();
    expect(parseTypedJpy("-500")).toBeNull();
    expect(parseTypedJpy(".")).toBeNull();
    expect(parseTypedJpy("abc")).toBeNull();
    expect(parseTypedJpy("0")).toBeNull();
  });
});
