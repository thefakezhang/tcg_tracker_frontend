// @vitest-environment jsdom
//
// He is standing in a shop with a receipt in his hand. What he needs on that
// screen is what this shop has cost him, what it has earned him, and somewhere
// to put the shipping line off the receipt - all at the grain of the shop,
// because that is the grain he checks out at.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

let shopCosts: Array<Record<string, unknown>> = [];

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
    if (fn === "buyer_source_costs") return Promise.resolve({ data: shopCosts, error: null });
    if (fn === "buyer_source_receipts") return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

beforeEach(() => {
  shopCosts = [{ source: "cardrush", kind: "shipping", amount_jpy: 800, note: null }];
  mountRpc();
});

// Each shop has its own controls, so every query below names the shop it means.
const shopHeader = (name: string) =>
  screen.getByRole("heading", { name }).closest("header") as HTMLElement;

describe("per-shop totals", () => {
  it("shows what this shop cost and what it earned him, per shop", async () => {
    render(<BuyerOrderView />);
    const header = (name: string) =>
      screen.getByRole("heading", { name }).closest("header") as HTMLElement;
    await screen.findByText("cardrush");
    // Scoped to the shop: the same figures also appear in the plan-wide total
    // at the top, and an unscoped query cannot tell which one it found.
    await waitFor(() => expect(within(header("cardrush")).getByText("¥30,800")).toBeTruthy());
    // His fee for this shop: 3% of card value + 100/row, computed server-side.
    expect(within(header("cardrush")).getByText("¥1,000")).toBeTruthy();
    // The shop he has not touched shows its own zeroes, not the other's money.
    expect(within(header("hareruya2")).getAllByText("¥0").length).toBeGreaterThan(0);
  });

  it("shows each cost he entered by name, not one lump he cannot take apart", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    // Shipping is recorded, so it reads as a figure he can press to correct.
    expect(within(shopHeader("cardrush")).getByRole("button", { name: /buyer\.costShipping ¥800/ })).toBeTruthy();
    // The kinds he has NOT entered are each offered, so a second receipt has
    // somewhere to go - there used to be one box no matter how many he held.
    expect(within(shopHeader("cardrush")).getByRole("button", { name: /\+ buyer\.costPaymentFee/ })).toBeTruthy();
    // Customs is not offered: he buys in Japan and pays at the counter.
    expect(within(shopHeader("cardrush")).queryByRole("button", { name: /buyer\.costCustoms/ })).toBeNull();
    expect(within(shopHeader("cardrush")).getByRole("button", { name: /\+ buyer\.costOther/ })).toBeTruthy();
  });

  it("records a cost against the shop he is checking out of", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    fireEvent.click(within(shopHeader("cardrush")).getByRole("button", { name: /\+ buyer\.costPaymentFee/ }));

    fireEvent.change(within(shopHeader("cardrush")).getByLabelText("buyer.costPaymentFee"), { target: { value: "1,200" } });
    fireEvent.click(within(shopHeader("cardrush")).getByRole("button", { name: "buyer.saveCost" }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("buyer_record_source_cost", {
        p_plan_id: 7, p_source: "cardrush", p_kind: "payment_fee",
        p_amount_jpy: 1200, p_note: null,
      }),
    );
  });

  it("opens an already-recorded cost with its figure, so correcting is not retyping", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    fireEvent.click(within(shopHeader("cardrush")).getByRole("button", { name: /buyer\.costShipping ¥800/ }));
    expect((within(shopHeader("cardrush")).getByLabelText("buyer.costShipping") as HTMLInputElement).value).toBe("800");
  });

  it("refuses to save an amount it could not read, rather than sending a NaN", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    fireEvent.click(within(shopHeader("cardrush")).getByRole("button", { name: /\+ buyer\.costOther/ }));

    const save = () => within(shopHeader("cardrush")).getByRole("button", { name: "buyer.saveCost" }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    fireEvent.change(within(shopHeader("cardrush")).getByLabelText("buyer.costOther"), { target: { value: "-" } });
    expect(save().disabled).toBe(true);
  });

  it("stops offering the form once the list is finalized, but still shows the figures", async () => {
    mountRpc({ finalized: true });
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    await waitFor(() => expect(screen.getAllByText("¥30,800").length).toBeGreaterThan(0));
    // The figures stay, as plain text: nothing left to press.
    expect(screen.queryByRole("button", { name: /buyer\.costShipping/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /\+ buyer\.costPaymentFee/ })).toBeNull();
    expect(screen.getByText("¥800")).toBeTruthy();
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
