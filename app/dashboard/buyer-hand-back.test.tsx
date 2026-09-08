// @vitest-environment jsdom
//
// He had no way to say he was finished. Only reconcile_purchase_plan, the
// OPERATOR's action, wrote a finalization, so the operator's single signal was
// a counter - which cannot tell "finished" from "stopped for lunch".

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));

import BuyerOrderView from "./BuyerOrderView";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const plan = (over: Record<string, unknown> = {}) => ({
  plan_id: 7, name: "August trip", status: "ordered",
  line_count: 2, recorded_count: 2, finalized: false, handed_back: false, ...over,
});

function line(id: number, source: string) {
  return {
    plan_line_id: id, source, source_listing_url: null,
    planned_quantity: 1, unit_price_orig: 1000, currency: "JPY",
    source_observed_at: new Date().toISOString(),
    card_name: "テストカード", card_english_name: "Test Card",
    set_code: "TST", card_number: "001/001", image_url: null,
    want_id: null, want_max: null, want_filled: null, want_ceiling: null,
    outcome: "purchased", purchased_quantity: 1, unit_price_jpy: 1000,
    condition_seen: null, note: null,
  };
}

let plans: Array<Record<string, unknown>> = [];
beforeEach(() => {
  plans = [plan()];
  rpc.mockReset();
  rpc.mockImplementation((fn: string) => {
    if (fn === "buyer_assigned_plans") return Promise.resolve({ data: plans, error: null });
    if (fn === "buyer_plan_lines") return Promise.resolve({ data: [line(1, "cardrush"), line(2, "hareruya2")], error: null });
    return Promise.resolve({ data: [], error: null });
  });
});

describe("handing the list back", () => {
  it("offers a finish button while there is still work open", async () => {
    render(<BuyerOrderView />);
    expect(await screen.findByRole("button", { name: "buyer.handBackList" })).toBeTruthy();
  });

  it("hands back on a fully recorded list without asking", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    render(<BuyerOrderView />);
    fireEvent.click(await screen.findByRole("button", { name: "buyer.handBackList" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("buyer_hand_back_plan", { p_plan_id: 7 }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks first when he is leaving lines behind, and does nothing if he declines", async () => {
    plans = [plan({ recorded_count: 0 })];
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<BuyerOrderView />);
    fireEvent.click(await screen.findByRole("button", { name: "buyer.handBackList" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "buyer.handBackList" })).toBeTruthy());
    expect(rpc.mock.calls.some(([f]) => f === "buyer_hand_back_plan")).toBe(false);
  });

  it("freezes his entry once handed back, and offers to reopen", async () => {
    plans = [plan({ handed_back: true })];
    render(<BuyerOrderView />);
    expect(await screen.findByRole("button", { name: "buyer.reopenList" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "buyer.handBackList" })).toBeNull();
    // Frozen: the outcome cells are read-only, same as a finalized plan.
    const outcome = document.querySelector<HTMLSelectElement>('[data-cell="1:outcome"]');
    expect(outcome === null || outcome.disabled).toBe(true);
  });

  it("reopens on his own say-so", async () => {
    plans = [plan({ handed_back: true })];
    render(<BuyerOrderView />);
    fireEvent.click(await screen.findByRole("button", { name: "buyer.reopenList" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("buyer_reopen_plan", { p_plan_id: 7 }));
  });

  it("does not offer either once the operator has closed it", async () => {
    plans = [plan({ finalized: true })];
    render(<BuyerOrderView />);
    await screen.findByText("buyer.closed");
    expect(screen.queryByRole("button", { name: "buyer.handBackList" })).toBeNull();
    expect(screen.queryByRole("button", { name: "buyer.reopenList" })).toBeNull();
  });
});

describe("choosing between lists", () => {
  it("is a dropdown, not a row of buttons", async () => {
    plans = [plan(), plan({ plan_id: 8, name: "Osaka run" })];
    render(<BuyerOrderView />);
    const select = await screen.findByLabelText("buyer.purchaseList");
    expect((select as HTMLSelectElement).tagName).toBe("SELECT");
    // Scoped: every outcome cell in the grid is a select with options too.
    expect(within(select).getAllByRole("option").length).toBe(2);
  });

  it("leaves closed lists out: they are not work he has left to do", async () => {
    plans = [
      plan(), plan({ plan_id: 8, name: "Osaka run" }),
      plan({ plan_id: 9, name: "Closed one", finalized: true }),
    ];
    render(<BuyerOrderView />);
    const select = await screen.findByLabelText("buyer.purchaseList");
    expect(within(select).getAllByRole("option").length).toBe(2);
    expect(within(select).queryByRole("option", { name: /Closed one/ })).toBeNull();
  });

  it("keeps a closed list visible while he is actually looking at it", async () => {
    // Filtering it out of the list he is ON would make it vanish under him.
    plans = [plan(), plan({ plan_id: 8, name: "Closed one", finalized: true })];
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    fireEvent.click(await screen.findByRole("button", { name: "buyer.handBackList" }));
    expect(screen.queryByRole("option", { name: /Closed one/ })).toBeNull();
  });

  it("opens on work still outstanding rather than whatever is newest", async () => {
    plans = [plan({ plan_id: 9, name: "Closed one", finalized: true }), plan({ plan_id: 8, name: "Still open" })];
    render(<BuyerOrderView />);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("buyer_plan_lines", { p_plan_id: 8 }));
  });

  it("does not show a picker for a single list", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    expect(screen.queryByLabelText("buyer.purchaseList")).toBeNull();
  });
});
