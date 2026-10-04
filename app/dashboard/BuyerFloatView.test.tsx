// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider, type Language } from "./LanguageContext";

const rpc = vi.fn();
const from = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc, from, auth: { getUser } }),
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
    select: self, eq: self, order: self,
    range: (fromIndex: number, toIndex: number) => Promise.resolve({
      data: rows.slice(fromIndex, toIndex + 1), error: null,
    }),
    then: (res: (v: { data: unknown[]; error: null }) => unknown) => res({ data: rows, error: null }),
  });
  return chain;
}

function failedTable(message: string) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, {
    select: self,
    eq: self,
    order: self,
    range: () => Promise.resolve({ data: null, error: { message } }),
  });
  return chain;
}

function successfulTable(name: string) {
  if (name === "buyer_float_balance_v") return table(balances);
  if (name === "gl_accounts") return table([{ account_id: 3, code: "1020", name: "Cash: Wise" }]);
  if (name === "trips") return table([{ trip_id: 4, name: "September" }]);
  if (name === "buyer_float_refundable_lines_v") return table(refundable);
  return table([]);
}

beforeEach(() => {
  localStorage.clear();
  rpc.mockReset();
  from.mockReset();
  getUser.mockReset().mockResolvedValue({
    data: { user: { id: "operator-1" } },
    error: null,
  });
  rpc.mockImplementation((name: string) => name === "assignable_buyers"
    ? table([{ email: "agent@example.com", has_account: true }])
    : Promise.resolve({ data: null, error: null }));
  from.mockImplementation(successfulTable);
});

function renderView(language: Language = "en") {
  return render(<LanguageProvider defaultLanguage={language}><BuyerFloatView /></LanguageProvider>);
}

// The email is on screen twice - as an option in the picker and as a row in
// the balance table - so wait on the picker specifically.
async function ready() {
  await waitFor(() => {
    const select = screen.getByLabelText("Send to") as HTMLSelectElement;
    expect(select.options.length).toBe(2);
    expect(select.disabled).toBe(false);
  });
}

async function fill() {
  renderView();
  await ready();
  fireEvent.change(screen.getByLabelText("Send to"), { target: { value: "agent@example.com" } });
  fireEvent.change(screen.getByLabelText("Left the account (USD)"), { target: { value: "1000" } });
  fireEvent.change(screen.getByLabelText("Transfer fee (USD)"), { target: { value: "6.5" } });
  fireEvent.change(screen.getByLabelText("Agent received (JPY)"), { target: { value: "146000" } });
}

function fillSettlement(jpy = "500", usd = "3.25") {
  fireEvent.change(screen.getByLabelText("Returned by"), { target: { value: "agent@example.com" } });
  fireEvent.change(screen.getByLabelText("Returned (JPY)"), { target: { value: jpy } });
  fireEvent.change(screen.getByLabelText("Actually received (USD)"), { target: { value: usd } });
}

describe("BuyerFloatView", () => {
  it("shows the running balance per agent in yen", async () => {
    renderView();
    expect(await screen.findByText("¥57,100")).toBeTruthy();
  });

  it("derives the rate from what left and what arrived", async () => {
    await fill();
    // 146,000 / (1000 - 6.50). Entering the rate as a third number invites a
    // set of three that disagree, and then the books and the agent disagree.
    await screen.findByText("¥146.96 / $1");
  });

  it("defaults the funding account to Wise", async () => {
    renderView();
    await waitFor(() =>
      expect((screen.getByLabelText("From") as HTMLSelectElement).value).toBe("1020"));
  });

  it("sends the whole movement in one call", async () => {
    await fill();
    fireEvent.change(document.getElementById("float-date")!, { target: { value: "2026-09-27" } });
    fireEvent.change(screen.getByLabelText("Note", { selector: "#float-note" }), { target: { value: "bank transfer" } });
    fireEvent.click(screen.getByRole("button", { name: "Record remittance" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("remit_to_buyer", expect.objectContaining({
        p_request_id: expect.any(String),
        p_buyer_email: "agent@example.com",
        p_cash_account: "1020",
        p_amount_usd: 1000,
        p_fee_usd: 6.5,
        p_amount_jpy: 146000,
        p_occurred_at: "2026-09-27",
        p_note: "bank transfer",
      })));
  });

  it("offers the whole outstanding amount when a cancelled purchase is picked", async () => {
    renderView();
    await ready();
    fireEvent.change(screen.getByLabelText("Purchase"), { target: { value: "11" } });
    // 50,000 paid, 10,000 already credited. Prefilling the remainder is the
    // common case; the operator can still cut it down for a partial.
    expect((screen.getByLabelText("Credit back (JPY)") as HTMLInputElement).value).toBe("40000");
  });

  it("refuses to credit back more than the purchase has left", async () => {
    renderView();
    await ready();
    fireEvent.change(screen.getByLabelText("Purchase"), { target: { value: "11" } });
    fireEvent.change(screen.getByLabelText("Credit back (JPY)"), { target: { value: "40001" } });
    expect((screen.getByRole("button", { name: "Record cancellation" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("ties the cancellation to the purchase it reverses, not just the agent", async () => {
    renderView();
    await ready();
    fireEvent.change(screen.getByLabelText("Purchase"), { target: { value: "11" } });
    fireEvent.click(screen.getByRole("button", { name: "Record cancellation" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("refund_buyer_float", expect.objectContaining({
        p_request_id: expect.any(String), p_plan_line_id: 11, p_amount_jpy: 40000,
      })));
  });

  it.each([
    ["buyer_float_balance_v", "Agent balances"],
    ["buyer_float_entries", "Recent movements"],
    ["gl_accounts", "Cash accounts"],
    ["assignable_buyers", "Assignable agents"],
    ["trips", "Trips"],
    ["buyer_float_refundable_lines_v", "Refundable purchases"],
  ])("fails closed when the %s read fails", async (failedSource, expectedLabel) => {
    if (failedSource === "assignable_buyers") {
      rpc.mockImplementation((name: string) => name === "assignable_buyers"
        ? failedTable("assignable_buyers denied")
        : Promise.resolve({ data: null, error: null }));
    } else {
      from.mockImplementation((name: string) => name === failedSource
        ? failedTable(`${name} denied`)
        : successfulTable(name));
    }

    renderView();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(expectedLabel);
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(screen.queryByText(/Nothing sent yet/)).toBeNull();
    expect(screen.queryByText("No movements recorded.")).toBeNull();
    expect(screen.queryByText("No cash account")).toBeNull();
    expect(screen.queryByRole("button", { name: "Record remittance" })).toBeNull();
  });

  it("retains the last complete snapshot when a refresh read fails", async () => {
    await fill();
    expect(screen.getByText("¥57,100")).toBeTruthy();
    from.mockImplementation((name: string) => name === "buyer_float_entries"
      ? failedTable("movements refresh denied")
      : successfulTable(name));

    fireEvent.click(screen.getByRole("button", { name: "Record remittance" }));

    expect((await screen.findByRole("alert")).textContent).toContain("movements refresh denied");
    expect(screen.getByText("¥57,100")).toBeTruthy();
    expect(screen.queryByText(/Nothing sent yet/)).toBeNull();
    expect(screen.queryByText("No movements recorded.")).toBeNull();
  });

  it("uses the legacy remittance overload only when the UUID signature is absent", async () => {
    rpc.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === "assignable_buyers") {
        return table([{ email: "agent@example.com", has_account: true }]);
      }
      if (name === "remit_to_buyer" && args && "p_request_id" in args) {
        return Promise.resolve({
          data: null,
          error: { code: "PGRST202", message: "UUID overload not in schema cache" },
        });
      }
      return Promise.resolve({ data: 17, error: null });
    });
    await fill();

    fireEvent.click(screen.getByRole("button", { name: "Record remittance" }));

    await waitFor(() => {
      const calls = rpc.mock.calls.filter(([name]) => name === "remit_to_buyer");
      expect(calls).toHaveLength(2);
      expect(calls[0][1]).toEqual(expect.objectContaining({ p_request_id: expect.any(String) }));
      expect(calls[1][1]).not.toHaveProperty("p_request_id");
    });
  });

  it("survives reload after a lost remittance response and retries the immutable UUID", async () => {
    rpc.mockImplementation((name: string) => name === "assignable_buyers"
      ? table([{ email: "agent@example.com", has_account: true }])
      : Promise.resolve({
        data: null,
        error: { code: "57014", message: "response lost after commit" },
      }));
    await fill();
    fireEvent.change(document.getElementById("float-date")!, { target: { value: "2026-09-28" } });
    fireEvent.change(screen.getByLabelText("Note", { selector: "#float-note" }), { target: { value: "do not change" } });

    fireEvent.click(screen.getByRole("button", { name: "Record remittance" }));
    expect((await screen.findByRole("alert")).textContent).toContain("response lost after commit");
    const firstCall = rpc.mock.calls.find(([name]) => name === "remit_to_buyer");
    const persisted = [...Array(localStorage.length)].map((_, index) => localStorage.key(index))
      .find((key) => key?.includes(":operator-1:remittance"));
    expect(persisted).toBeTruthy();
    expect((screen.getByLabelText("Left the account (USD)") as HTMLInputElement).disabled).toBe(true);

    cleanup();
    renderView();
    const retry = await screen.findByRole("button", { name: "Retry exact request" });
    expect((screen.getByLabelText("Left the account (USD)") as HTMLInputElement).value).toBe("1000");
    expect((document.getElementById("float-date") as HTMLInputElement).value).toBe("2026-09-28");
    expect((screen.getByLabelText("Note", { selector: "#float-note" }) as HTMLInputElement).value).toBe("do not change");
    expect((screen.getByLabelText("Left the account (USD)") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(retry);

    await waitFor(() => {
      const calls = rpc.mock.calls.filter(([name]) => name === "remit_to_buyer");
      expect(calls).toHaveLength(2);
      expect(calls[0][1].p_request_id).toBe(firstCall?.[1].p_request_id);
      expect(calls[0][1].p_request_id).toBe(calls[1][1].p_request_id);
      expect(calls.every(([, args]) => "p_request_id" in args)).toBe(true);
    });
  });

  it("keeps cancellation and return dates and notes independent", async () => {
    renderView();
    await ready();
    fireEvent.change(screen.getByLabelText("Purchase"), { target: { value: "11" } });
    fireEvent.change(document.getElementById("refund-date")!, { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByLabelText("Note", { selector: "#refund-note" }), { target: { value: "shop cancellation" } });
    fireEvent.click(screen.getByRole("button", { name: "Record cancellation" }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("refund_buyer_float", expect.objectContaining({
      p_occurred_at: "2026-09-20",
      p_note: "shop cancellation",
    })));

    fillSettlement();
    fireEvent.change(document.getElementById("settle-date")!, { target: { value: "2026-09-21" } });
    fireEvent.change(screen.getByLabelText("Note", { selector: "#settle-note" }), { target: { value: "cash handoff" } });
    fireEvent.click(screen.getByRole("button", { name: "Record return" }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("settle_buyer_float", expect.objectContaining({
      p_request_id: expect.any(String),
      p_buyer_email: "agent@example.com",
      p_cash_account: "1020",
      p_amount_usd: 3.25,
      p_amount_jpy: 500,
      p_occurred_at: "2026-09-21",
      p_trip_id: null,
      p_note: "cash handoff",
    })));
  });

  it("derives the settlement rate from actual cash returned", async () => {
    renderView();
    await ready();
    fillSettlement("500", "3.25");

    expect(screen.getByText("¥153.85 / $1")).toBeTruthy();
  });

  it("never falls back to a settlement signature without cash evidence", async () => {
    rpc.mockImplementation((name: string) => name === "assignable_buyers"
      ? table([{ email: "agent@example.com", has_account: true }])
      : Promise.resolve({
        data: null,
        error: { code: "PGRST202", message: "upgraded settlement signature unavailable" },
      }));
    renderView();
    await ready();
    fillSettlement();

    fireEvent.click(screen.getByRole("button", { name: "Record return" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("upgraded settlement signature unavailable");
    const calls = rpc.mock.calls.filter(([name]) => name === "settle_buyer_float");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual(expect.objectContaining({
      p_request_id: expect.any(String),
      p_cash_account: "1020",
      p_amount_usd: 3.25,
    }));
  });

  it("restores and retries the exact settlement after an unknown outcome", async () => {
    rpc.mockImplementation((name: string) => name === "assignable_buyers"
      ? table([{ email: "agent@example.com", has_account: true }])
      : Promise.resolve({
        data: null,
        error: { code: "57014", message: "settlement response lost" },
      }));
    renderView();
    await ready();
    fillSettlement("700", "4.50");
    fireEvent.change(document.getElementById("settle-date")!, { target: { value: "2026-09-22" } });
    fireEvent.change(screen.getByLabelText("Note", { selector: "#settle-note" }), { target: { value: "exact cash return" } });

    fireEvent.click(screen.getByRole("button", { name: "Record return" }));
    expect((await screen.findByRole("alert")).textContent).toContain("settlement response lost");
    const first = rpc.mock.calls.find(([name]) => name === "settle_buyer_float")?.[1];
    expect(first).toEqual(expect.objectContaining({
      p_request_id: expect.any(String),
      p_cash_account: "1020",
      p_amount_usd: 4.5,
      p_amount_jpy: 700,
      p_occurred_at: "2026-09-22",
      p_note: "exact cash return",
    }));

    cleanup();
    renderView();
    const retry = await screen.findByRole("button", { name: "Retry exact request" });
    expect((screen.getByLabelText("Deposited to") as HTMLSelectElement).value).toBe("1020");
    expect((screen.getByLabelText("Actually received (USD)") as HTMLInputElement).value).toBe("4.5");
    expect((screen.getByLabelText("Returned (JPY)") as HTMLInputElement).value).toBe("700");
    expect((document.getElementById("settle-date") as HTMLInputElement).value).toBe("2026-09-22");
    expect((screen.getByLabelText("Actually received (USD)") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(retry);

    await waitFor(() => {
      const calls = rpc.mock.calls.filter(([name]) => name === "settle_buyer_float");
      expect(calls).toHaveLength(2);
      expect(calls[1][1]).toEqual(calls[0][1]);
    });
  });

  it("surfaces a refund mutation failure", async () => {
    rpc.mockImplementation((name: string) => name === "assignable_buyers"
      ? table([{ email: "agent@example.com", has_account: true }])
      : Promise.resolve({ data: null, error: { code: "P0001", message: "refund rejected" } }));
    renderView();
    await ready();
    fireEvent.change(screen.getByLabelText("Purchase"), { target: { value: "11" } });

    fireEvent.click(screen.getByRole("button", { name: "Record cancellation" }));

    const card = screen.getByText("A shop cancelled").closest("div.rounded-xl") ?? screen.getByText("A shop cancelled").parentElement?.parentElement;
    expect((await screen.findByRole("alert")).textContent).toContain("refund rejected");
    expect(card?.textContent).toContain("refund rejected");
  });

  it("surfaces a settlement mutation failure", async () => {
    rpc.mockImplementation((name: string) => name === "assignable_buyers"
      ? table([{ email: "agent@example.com", has_account: true }])
      : Promise.resolve({ data: null, error: { code: "P0001", message: "settlement rejected" } }));
    renderView();
    await ready();
    fillSettlement();

    fireEvent.click(screen.getByRole("button", { name: "Record return" }));

    const card = screen.getByText("Agent returned cash").closest("div.rounded-xl") ?? screen.getByText("Agent returned cash").parentElement?.parentElement;
    expect((await screen.findByRole("alert")).textContent).toContain("settlement rejected");
    expect(card?.textContent).toContain("settlement rejected");
  });

  it("says so when there is no cash account to send from", async () => {
    from.mockImplementation((name: string) => {
      if (name === "buyer_float_balance_v") return table(balances);
      return table([]);
    });
    renderView();
    await waitFor(() => {
      expect((screen.getByLabelText("From") as HTMLSelectElement).disabled).toBe(true);
      expect((screen.getByLabelText("Deposited to") as HTMLSelectElement).disabled).toBe(true);
    });
    expect(screen.getAllByText("No cash account")).toHaveLength(2);
  });

  it("will not send until it knows who, from where, and how much", async () => {
    renderView();
    await ready();
    expect((screen.getByRole("button", { name: "Record remittance" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("refuses a transfer the fee would consume entirely", async () => {
    await fill();
    fireEvent.change(screen.getByLabelText("Transfer fee (USD)"), { target: { value: "1200" } });
    expect((screen.getByRole("button", { name: "Record remittance" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders the complete operator workflow in Japanese", async () => {
    renderView("ja");
    expect(await screen.findByText("購入担当者へ送金")).toBeTruthy();
    expect(screen.getByText("店舗でキャンセル")).toBeTruthy();
    expect(screen.getByText("担当者から現金返却")).toBeTruthy();
    expect(screen.getByText("担当者の保有金")).toBeTruthy();
    expect(screen.getByText("最近の入出金")).toBeTruthy();
  });
});
