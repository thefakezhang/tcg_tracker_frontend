// @vitest-environment jsdom
//
// Between "he bought it" and "it is on the shelf" a card spends weeks
// somewhere. The route depends on where it was bought, and a Snkrdunk card is
// authenticated on the way - a leg with its own way of going wrong.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));

import BuyerOrderView from "./BuyerOrderView";

afterEach(cleanup);

const plan = {
  plan_id: 7, name: "trip", status: "ordered",
  line_count: 2, recorded_count: 2, finalized: false, handed_back: false,
};

function line(over: Record<string, unknown> = {}) {
  return {
    plan_line_id: 1, source: "snkrdunk", source_listing_url: null,
    planned_quantity: 1, unit_price_orig: 8000, currency: "JPY",
    source_observed_at: "2026-09-06T00:00:00Z",
    card_name: "card-1", card_english_name: null, set_code: "TST",
    card_number: "001/001", image_url: null,
    want_id: null, want_max: null, want_filled: null, want_ceiling: null,
    outcome: "purchased", purchased_quantity: 1, unit_price_jpy: 8000,
    condition_seen: null, note: null,
    delivery_status: null, delivery_status_at: null, delivery_flow: "curated",
    ...over,
  };
}

let lines: Array<Record<string, unknown>> = [];
beforeEach(() => {
  lines = [line()];
  rpc.mockReset();
  rpc.mockImplementation((fn: string) => {
    if (fn === "buyer_assigned_plans") return Promise.resolve({ data: [plan], error: null });
    if (fn === "buyer_plan_lines") return Promise.resolve({ data: lines, error: null });
    if (fn === "buyer_set_delivery_status") return Promise.resolve({ data: 1, error: null });
    return Promise.resolve({ data: [], error: null });
  });
});

const rowSelect = () =>
  within(document.querySelector("tbody tr") as HTMLElement)
    .getByLabelText("buyer.colDelivery") as HTMLSelectElement;

const optionsOf = (sel: HTMLSelectElement) =>
  Array.from(sel.options).map((o) => o.value).filter(Boolean);

describe("where the card is", () => {
  it("is locked until he has actually bought it", async () => {
    lines = [line({ outcome: "sold_out", purchased_quantity: 0, unit_price_jpy: null })];
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    // A card he did not buy has nowhere to be, and the database refuses one.
    expect(within(document.querySelector("tbody tr") as HTMLElement)
      .queryByLabelText("buyer.colDelivery")).toBeNull();
  });

  it("offers every status on the shop's route, so a mistake can be undone", async () => {
    // It used to offer only the step that follows the current one, which made
    // a mis-tap permanent - and from arrived or cancelled it offered nothing
    // at all, so the control disappeared and the wrong answer stood for ever.
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    expect(optionsOf(rowSelect())).toEqual([
      "ordered", "sent_to_curation", "curating", "curation_failed",
      "sent_to_buyer", "arrived", "cancelled",
    ]);
  });

  it("still offers a way out of the states that used to be dead ends", async () => {
    for (const stuck of ["arrived", "cancelled"]) {
      cleanup();
      lines = [line({ delivery_status: stuck })];
      render(<BuyerOrderView />);
      await screen.findByText("card-1");
      expect(optionsOf(rowSelect()).length, stuck).toBeGreaterThan(1);
      expect(rowSelect().value, stuck).toBe(stuck);
    }
  });

  it("shows where the card is now, as the control itself", async () => {
    lines = [line({ delivery_status: "curating" })];
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    expect(rowSelect().value).toBe("curating");
  });

  it("never offers a store card the authentication states it cannot reach", async () => {
    lines = [line({ source: "cardrush", delivery_flow: "direct", delivery_status: "ordered" })];
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    expect(optionsOf(rowSelect())).toEqual(["ordered", "sent_to_buyer", "arrived", "cancelled"]);
  });

  it("records the step he picked against that one line", async () => {
    lines = [line({ delivery_status: "ordered" })];
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    fireEvent.change(rowSelect(), { target: { value: "sent_to_curation" } });
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("buyer_set_delivery_status", {
        p_plan_id: 7, p_source: "snkrdunk", p_status: "sent_to_curation", p_plan_line_id: 1,
      }));
  });
});

describe("when authentication says the card is not what was listed", () => {
  it("offers cancel and continue out of the same field", async () => {
    // The operator asked whether this needs its own column. It does not: a
    // flagged card is sitting at the authenticator, which is a place on the
    // journey, so the decision is two values of this field, not a second one.
    lines = [line({ delivery_status: "curation_failed" })];
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    expect(rowSelect().value).toBe("curation_failed");
    expect(optionsOf(rowSelect())).toContain("cancelled");
    expect(optionsOf(rowSelect())).toContain("sent_to_buyer");
  });

  it("marks the flagged card so it is not lost among the rest", async () => {
    lines = [line({ delivery_status: "curation_failed" })];
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    expect(rowSelect().className).toMatch(/amber/);
  });

  it("keeps arrived and cancelled changeable, because he may have slipped", async () => {
    // These two were the end of the road: no options, so the control was not
    // rendered at all and the answer could never be taken back. That is what
    // "I cannot update the delivery status after setting it" was.
    for (const status of ["arrived", "cancelled"]) {
      cleanup();
      lines = [line({ delivery_status: status })];
      render(<BuyerOrderView />);
      await screen.findByText("card-1");
      const select = within(document.querySelector("tbody tr") as HTMLElement)
        .getByLabelText("buyer.colDelivery") as HTMLSelectElement;
      expect(select.value, status).toBe(status);
      expect(optionsOf(select), status).toContain("ordered");
    }
  });
});

describe("moving a whole shop", () => {
  it("moves every bought row in the shop in one go", async () => {
    // He orders a shop in one basket and it arrives as one parcel.
    lines = [line({ plan_line_id: 1, delivery_status: "ordered" }),
             line({ plan_line_id: 2, card_name: "card-2", delivery_status: "ordered" })];
    render(<BuyerOrderView />);
    await screen.findByText("card-2");
    fireEvent.change(await screen.findByLabelText("buyer.delivBulk"),
      { target: { value: "sent_to_curation" } });
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("buyer_set_delivery_status", {
        p_plan_id: 7, p_source: "snkrdunk", p_status: "sent_to_curation", p_plan_line_id: null,
      }));
  });

  it("says how many rows actually moved, because the rest were skipped", async () => {
    lines = [line({ delivery_status: "ordered" })];
    rpc.mockImplementation((fn: string) => {
      if (fn === "buyer_assigned_plans") return Promise.resolve({ data: [plan], error: null });
      if (fn === "buyer_plan_lines") return Promise.resolve({ data: lines, error: null });
      if (fn === "buyer_set_delivery_status") return Promise.resolve({ data: 29, error: null });
      return Promise.resolve({ data: [], error: null });
    });
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    fireEvent.change(await screen.findByLabelText("buyer.delivBulk"),
      { target: { value: "sent_to_curation" } });
    expect(await screen.findByText("buyer.delivBulkDone")).toBeTruthy();
  });

  it("covers a parcel whose rows are not all on the same step", async () => {
    lines = [line({ plan_line_id: 1, delivery_status: "ordered" }),
             line({ plan_line_id: 2, card_name: "card-2", delivery_status: "curating" })];
    render(<BuyerOrderView />);
    await screen.findByText("card-2");
    const bulk = await screen.findByLabelText("buyer.delivBulk") as HTMLSelectElement;
    // Every status the route allows, so one control covers a parcel whose rows
    // are not all on the same step - and can put the shop back if he slipped.
    expect(optionsOf(bulk)).toEqual([
      "ordered", "sent_to_curation", "curating", "curation_failed",
      "sent_to_buyer", "arrived", "cancelled",
    ]);
  });

  it("offers nothing for a shop where he bought nothing", async () => {
    lines = [line({ outcome: "sold_out", purchased_quantity: 0, unit_price_jpy: null })];
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    expect(screen.queryByLabelText("buyer.delivBulk")).toBeNull();
  });
});

// He hands the list back the evening he stops buying. Everything that happens
// to the cards after that - shipped, authenticated, arrived - happens while
// the list is handed back, and he is the one who watches it.
describe("after he has handed the list back", () => {
  it("still lets him say where the cards are", async () => {
    lines = [line({ delivery_status: "ordered" })];
    rpc.mockImplementation((fn: string) => {
      if (fn === "buyer_assigned_plans") {
        return Promise.resolve({ data: [{ ...plan, handed_back: true }], error: null });
      }
      if (fn === "buyer_plan_lines") return Promise.resolve({ data: lines, error: null });
      if (fn === "buyer_set_delivery_status") return Promise.resolve({ data: 1, error: null });
      return Promise.resolve({ data: [], error: null });
    });
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    expect(optionsOf(rowSelect())).toContain("sent_to_curation");
    expect(await screen.findByLabelText("buyer.delivBulk")).toBeTruthy();
  });

  it("still refuses to let him rewrite what he did at the counter", async () => {
    lines = [line({ delivery_status: "ordered" })];
    rpc.mockImplementation((fn: string) => {
      if (fn === "buyer_assigned_plans") {
        return Promise.resolve({ data: [{ ...plan, handed_back: true }], error: null });
      }
      if (fn === "buyer_plan_lines") return Promise.resolve({ data: lines, error: null });
      return Promise.resolve({ data: [], error: null });
    });
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    const outcome = document.querySelector<HTMLSelectElement>('[data-cell="1:outcome"]')!;
    expect(outcome.disabled).toBe(true);
  });

  it("stops the delivery too once the operator closes the trip", async () => {
    lines = [line({ delivery_status: "ordered" })];
    rpc.mockImplementation((fn: string) => {
      if (fn === "buyer_assigned_plans") {
        return Promise.resolve({ data: [{ ...plan, finalized: true }], error: null });
      }
      if (fn === "buyer_plan_lines") return Promise.resolve({ data: lines, error: null });
      return Promise.resolve({ data: [], error: null });
    });
    render(<BuyerOrderView />);
    await screen.findByText("card-1");
    expect(within(document.querySelector("tbody tr") as HTMLElement)
      .queryByLabelText("buyer.colDelivery")).toBeNull();
    expect(screen.queryByLabelText("buyer.delivBulk")).toBeNull();
  });
});
