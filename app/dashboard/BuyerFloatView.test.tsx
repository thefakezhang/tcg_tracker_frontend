// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc, from }),
}));

import BuyerFloatView from "./BuyerFloatView";

afterEach(cleanup);

const balances = [{
  buyer_email: "agent@example.com",
  remitted_jpy: 150000, spent_jpy: 90000, fees_jpy: 2900,
  refunded_jpy: 0, settled_jpy: 0, balance_jpy: 57100,
}];

const refundable = [{
  buyer_email: "agent@example.com", plan_line_id: 11, plan_id: 3, plan_name: "September",
  source: "cardrush", regional_name: "リザードン", english_name: "Charizard",
  set_code: "SV1", card_number: "001/078",
  purchased_quantity: 1, unit_price_jpy: 50000, paid_jpy: 50000,
  refunded_jpy: 10000, refundable_jpy: 40000,
}];

function table(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, {
    select: self, eq: self, order: self, limit: () => Promise.resolve({ data: rows, error: null }),
    then: (res: (v: { data: unknown[]; error: null }) => unknown) => res({ data: rows, error: null }),
  });
  return chain;
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  rpc.mockResolvedValue({ data: [{ email: "agent@example.com", has_account: true }], error: null });
  from.mockImplementation((name: string) => {
    if (name === "buyer_float_balance_v") return table(balances);
    if (name === "gl_accounts") return table([{ account_id: 3, code: "1020", name: "Cash: Wise" }]);
    if (name === "trips") return table([{ trip_id: 4, name: "September" }]);
    if (name === "buyer_float_refundable_lines_v") return table(refundable);
    return table([]);
  });
});

// The email is on screen twice - as an option in the picker and as a row in
// the balance table - so wait on the picker specifically.
async function ready() {
  await waitFor(() =>
    expect((screen.getByLabelText("Send to") as HTMLSelectElement).options.length).toBe(2));
}

async function fill() {
  render(<BuyerFloatView />);
  await ready();
  fireEvent.change(screen.getByLabelText("Send to"), { target: { value: "agent@example.com" } });
  fireEvent.change(screen.getByLabelText("Left the account (USD)"), { target: { value: "1000" } });
  fireEvent.change(screen.getByLabelText("Transfer fee (USD)"), { target: { value: "6.5" } });
  fireEvent.change(screen.getByLabelText("He received (JPY)"), { target: { value: "146000" } });
}

describe("BuyerFloatView", () => {
  it("shows the running balance per agent in yen", async () => {
    render(<BuyerFloatView />);
    expect(await screen.findByText("¥57,100")).toBeTruthy();
  });

  it("derives the rate from what left and what arrived", async () => {
    await fill();
    // 146,000 / (1000 - 6.50). Entering the rate as a third number invites a
    // set of three that disagree, and then the books and the agent disagree.
    await screen.findByText("¥146.96 / $1");
  });

  it("defaults the funding account to Wise", async () => {
    render(<BuyerFloatView />);
    await waitFor(() =>
      expect((screen.getByLabelText("From") as HTMLSelectElement).value).toBe("1020"));
  });

  it("sends the whole movement in one call", async () => {
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Record remittance" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("remit_to_buyer", expect.objectContaining({
        p_buyer_email: "agent@example.com",
        p_cash_account: "1020",
        p_amount_usd: 1000,
        p_fee_usd: 6.5,
        p_amount_jpy: 146000,
      })));
  });

  it("offers the whole outstanding amount when a cancelled purchase is picked", async () => {
    render(<BuyerFloatView />);
    await ready();
    fireEvent.change(screen.getByLabelText("Purchase"), { target: { value: "11" } });
    // 50,000 paid, 10,000 already credited. Prefilling the remainder is the
    // common case; the operator can still cut it down for a partial.
    expect((screen.getByLabelText("Credit back (JPY)") as HTMLInputElement).value).toBe("40000");
  });

  it("refuses to credit back more than the purchase has left", async () => {
    render(<BuyerFloatView />);
    await ready();
    fireEvent.change(screen.getByLabelText("Purchase"), { target: { value: "11" } });
    fireEvent.change(screen.getByLabelText("Credit back (JPY)"), { target: { value: "40001" } });
    expect((screen.getByRole("button", { name: "Record cancellation" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("ties the cancellation to the purchase it reverses, not just the agent", async () => {
    render(<BuyerFloatView />);
    await ready();
    fireEvent.change(screen.getByLabelText("Purchase"), { target: { value: "11" } });
    fireEvent.click(screen.getByRole("button", { name: "Record cancellation" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("refund_buyer_float", expect.objectContaining({
        p_plan_line_id: 11, p_amount_jpy: 40000,
      })));
  });

  it("does not sit on Loading when the balance query fails", async () => {
    from.mockImplementation((name: string) => {
      if (name === "buyer_float_balance_v") {
        const chain: Record<string, unknown> = {};
        Object.assign(chain, {
          select: () => chain,
          then: (res: (v: { data: null; error: { message: string } }) => unknown) =>
            res({ data: null, error: { message: "permission denied" } }),
        });
        return chain;
      }
      if (name === "gl_accounts") return table([{ account_id: 3, code: "1020", name: "Cash: Wise" }]);
      return table([]);
    });
    render(<BuyerFloatView />);
    // The reason belongs on screen, but so does an answer for the table: an
    // endless "Loading..." reads as a slow query rather than a failed one.
    await screen.findByText(/Nothing sent yet/);
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("says so when there is no cash account to send from", async () => {
    from.mockImplementation((name: string) => {
      if (name === "buyer_float_balance_v") return table(balances);
      return table([]);
    });
    render(<BuyerFloatView />);
    await waitFor(() =>
      expect((screen.getByLabelText("From") as HTMLSelectElement).disabled).toBe(true));
    expect(screen.getByText("No cash account")).toBeTruthy();
  });

  it("will not send until it knows who, from where, and how much", async () => {
    render(<BuyerFloatView />);
    await ready();
    expect((screen.getByRole("button", { name: "Record remittance" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("refuses a transfer the fee would consume entirely", async () => {
    await fill();
    fireEvent.change(screen.getByLabelText("Transfer fee (USD)"), { target: { value: "1200" } });
    expect((screen.getByRole("button", { name: "Record remittance" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
