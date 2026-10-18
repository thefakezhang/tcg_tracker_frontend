// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
// The view now translates; the tests assert behaviour, so the key is the label.
vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    language: "en",
    t: (key: string, params?: Record<string, string | number>) =>
      params ? `${key} ${Object.values(params).join(" ")}` : key,
  }),
}));
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
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
  it.each([
    [{ code: "PGRST301", message: "JWT expired" }, 401, "common.sessionExpired"],
    [{ code: "42501", message: "permission denied" }, 403, "common.accessDenied"],
  ])("surfaces a receipt authorization failure instead of an empty list: %s", async (error, status, title) => {
    const normal = rpc.getMockImplementation()!;
    rpc.mockImplementation((fn: string, args: unknown) => fn === "buyer_source_receipts"
      ? Promise.resolve({ data: null, error, status }) : normal(fn, args));
    render(<BuyerOrderView />);
    const panel = await screen.findByRole("region", { name: "buyer.receiptLoadFailed" });
    expect(within(panel).getByRole("alert").textContent).toContain(title);
    if (status === 401) expect(within(panel).getByRole("link", { name: "common.signInAgain" }).getAttribute("href")).toBe("/login");
  });

  it("retries a thrown receipt read failure and renders the returned count", async () => {
    const normal = rpc.getMockImplementation()!;
    let receiptReads = 0;
    rpc.mockImplementation((fn: string, args: unknown) => {
      if (fn !== "buyer_source_receipts") return normal(fn, args);
      receiptReads += 1;
      return receiptReads === 1 ? Promise.reject(new Error("connection lost"))
        : Promise.resolve({ data: [{ receipt_id: 1, source: "cardrush", storage_path: "plan-receipts/7/cardrush/a.pdf" }], error: null });
    });
    render(<BuyerOrderView />);
    const panel = await screen.findByRole("region", { name: "buyer.receiptLoadFailed" });
    fireEvent.click(within(panel).getByRole("button", { name: "common.retry" }));
    await screen.findByText("buyer.receiptCount 1");
    expect(screen.queryByRole("region", { name: "buyer.receiptLoadFailed" })).toBeNull();
    expect(receiptReads).toBe(2);
  });

  it("shows an assigned-list session error and retries the initial load", async () => {
    let attempts = 0;
    rpc.mockImplementation((fn: string) => {
      if (fn === "buyer_assigned_plans") {
        attempts += 1;
        return attempts === 1
          ? Promise.resolve({ data: null, error: { message: "session expired" } })
          : Promise.resolve({ data: [plan], error: null });
      }
      if (fn === "buyer_plan_lines") {
        return Promise.resolve({ data: [line(1, "cardrush")], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    render(<BuyerOrderView />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("buyer.loadPlansFailed");
    expect(alert.textContent).toContain("session expired");

    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    expect(await screen.findByText("cardrush")).toBeTruthy();
    expect(attempts).toBe(2);
  });

  it("shows a transient assigned-list failure and retries the initial load", async () => {
    let attempts = 0;
    rpc.mockImplementation((fn: string) => {
      if (fn === "buyer_assigned_plans") {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error("network unavailable"))
          : Promise.resolve({ data: [plan], error: null });
      }
      if (fn === "buyer_plan_lines") {
        return Promise.resolve({ data: [line(1, "cardrush")], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    render(<BuyerOrderView />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("network unavailable");

    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    expect(await screen.findByText("cardrush")).toBeTruthy();
    expect(attempts).toBe(2);
  });

  it("groups lines by source, because he checks out one shop at a time", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    expect(screen.getByText("hareruya2")).toBeTruthy();
  });

  it("names the exact condition and edition on a sealed buying instruction", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "buyer_assigned_plans") return Promise.resolve({ data: [{ ...plan, line_count: 1 }], error: null });
      if (fn === "buyer_plan_lines") return Promise.resolve({ data: [{
        ...line(9, "cardrush"),
        game: "pokemon_sealed",
        product_id: 41,
        card_name: "テストボックス",
        card_english_name: "Test Box",
        card_number: null,
        sealed_condition: "no_shrink",
        variant_edition: "unlimited",
      }], error: null });
      if (fn === "buyer_source_receipts") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    });

    render(<BuyerOrderView />);
    expect(await screen.findByText("テストボックス")).toBeTruthy();
    expect(screen.getByText(/sealedBrowser.editionUnlimited/).textContent).toContain("sealedBrowser.conditionNoShrink");
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
    await screen.findByText(/buyer.openForEditing/);
  });

  it("offers a receipt upload per source", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    // One per shop, because each shop is its own checkout.
    expect(screen.getAllByText(/buyer.uploadReceipt/).length).toBe(2);
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
    expect(screen.getAllByText("buyer.wantAcrossSources").length).toBe(2);
  });

  it("renders stale-price timing as visible accessible text", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "buyer_assigned_plans") return Promise.resolve({ data: [plan], error: null });
      if (fn === "buyer_plan_lines") {
        return Promise.resolve({ data: [{
          ...line(1, "cardrush"),
          source_observed_at: "2020-01-02T03:04:00Z",
        }], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");

    const note = screen.getByRole("note");
    expect(note.textContent).toContain("buyer.priceMayBeStale");
    expect(note.textContent).toContain("buyer.priceObservedAt");
    expect(note.hasAttribute("title")).toBe(false);
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

  it("does not queue a purchase after the shared want is already filled", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "buyer_assigned_plans") return Promise.resolve({ data: [plan], error: null });
      if (fn === "buyer_plan_lines") {
        return Promise.resolve({ data: [{
          ...line(1, "cardrush"),
          planned_quantity: 20,
          want_id: 9,
          want_max: 20,
          want_filled: 20,
        }], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    rpc.mockClear();

    const outcome = document.querySelector<HTMLSelectElement>('[data-cell="1:outcome"]')!;
    fireEvent.change(outcome, { target: { value: "purchased" } });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("buyer.wantAlreadyFilled");
    expect(outcome.value).toBe("pending");
    expect(document.querySelector<HTMLInputElement>('[data-cell="1:qty"]')!.value).toBe("");
    await act(async () => { await new Promise((done) => setTimeout(done, 550)); });
    expect(rpc).not.toHaveBeenCalledWith("buyer_record_result", expect.anything());
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
    expect(alert.textContent).toContain("buyer.needQtyAndPrice");
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
    expect(screen.getByText(/buyer.closed/)).toBeTruthy();
  });

  it("restores the condition returned by the scoped line reader", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "buyer_assigned_plans") return Promise.resolve({ data: [plan], error: null });
      if (fn === "buyer_plan_lines") {
        return Promise.resolve({
          data: [{
            ...line(1, "cardrush"),
            outcome: "purchased",
            purchased_quantity: 1,
            unit_price_jpy: 1000,
            condition_seen: "EX",
          }],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    expect(document.querySelector<HTMLSelectElement>('[data-cell="1:condition"]')?.value).toBe("EX");
  });

  it("moves left and right across editable cells", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "buyer_assigned_plans") return Promise.resolve({ data: [plan], error: null });
      if (fn === "buyer_plan_lines") {
        return Promise.resolve({
          data: [{
            ...line(1, "cardrush"),
            outcome: "purchased",
            purchased_quantity: 1,
            unit_price_jpy: 1000,
          }],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    const quantity = document.querySelector<HTMLInputElement>('[data-cell="1:qty"]')!;
    quantity.focus();
    fireEvent.keyDown(quantity, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("data-cell")).toBe("1:price");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement?.getAttribute("data-cell")).toBe("1:qty");
  });

  it("applies a valid multi-cell paste with one complete save", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    rpc.mockClear();
    const outcome = document.querySelector<HTMLSelectElement>('[data-cell="1:outcome"]')!;
    fireEvent.paste(outcome, {
      clipboardData: { getData: () => "Bought\t1\t1450\tLP\tchecked" },
    });

    await waitFor(() => expect(
      document.querySelector<HTMLSelectElement>('[data-cell="1:condition"]')?.value,
    ).toBe("LP"));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("buyer_record_result", {
        p_plan_line_id: 1,
        p_outcome: "purchased",
        p_purchased_quantity: 1,
        p_unit_price_jpy: 1450,
        p_condition_seen: "LP",
        p_note: "checked",
      }),
    );
  });

  it("explains an invalid multi-cell paste without changing or saving a cell", async () => {
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    rpc.mockClear();
    const outcome = document.querySelector<HTMLSelectElement>('[data-cell="1:outcome"]')!;
    fireEvent.paste(outcome, {
      clipboardData: { getData: () => "Bought\t1\t1450\tEXCELLENT\tbad" },
    });

    expect((await screen.findByRole("alert")).textContent).toContain("buyer.paste.invalidCondition");
    expect(outcome.value).toBe("pending");
    expect(rpc).not.toHaveBeenCalledWith("buyer_record_result", expect.anything());
  });

  it("retains a failed edit and retries it from the row status", async () => {
    let attempts = 0;
    rpc.mockImplementation((fn: string) => {
      if (fn === "buyer_assigned_plans") return Promise.resolve({ data: [plan], error: null });
      if (fn === "buyer_plan_lines") {
        return Promise.resolve({ data: [line(1, "cardrush")], error: null });
      }
      if (fn === "buyer_record_result") {
        attempts += 1;
        return Promise.resolve(attempts === 1
          ? { data: null, error: { message: "temporary save failure" } }
          : { data: null, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    const note = document.querySelector<HTMLInputElement>('[data-cell="1:note"]')!;
    fireEvent.change(note, { target: { value: "keep this" } });
    fireEvent.blur(note);

    const retry = await screen.findByRole("button", { name: "buyer.retrySave" });
    expect(note.value).toBe("keep this");
    fireEvent.click(retry);
    await waitFor(() => expect(attempts).toBe(2));
    await waitFor(() => expect(screen.getAllByText("buyer.saved").length).toBeGreaterThan(0));
  });

  it("waits for pending edits before loading a different plan", async () => {
    let resolveSave!: (value: { data: null; error: null }) => void;
    const pendingSave = new Promise<{ data: null; error: null }>((resolve) => { resolveSave = resolve; });
    const plans = [plan, { ...plan, plan_id: 8, name: "Next trip" }];
    rpc.mockImplementation((fn: string, args?: { p_plan_id?: number }) => {
      if (fn === "buyer_assigned_plans") return Promise.resolve({ data: plans, error: null });
      if (fn === "buyer_plan_lines") {
        return Promise.resolve({ data: [line(args?.p_plan_id ?? 1, "cardrush")], error: null });
      }
      if (fn === "buyer_record_result") return pendingSave;
      return Promise.resolve({ data: [], error: null });
    });
    render(<BuyerOrderView />);
    await screen.findByText("cardrush");
    const note = document.querySelector<HTMLInputElement>('[data-cell="7:note"]')!;
    fireEvent.change(note, { target: { value: "save before switch" } });
    fireEvent.change(screen.getByLabelText("buyer.purchaseList"), { target: { value: "8" } });

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("buyer_record_result", expect.anything()));
    expect(rpc).not.toHaveBeenCalledWith("buyer_plan_lines", { p_plan_id: 8 });
    await act(async () => { resolveSave({ data: null, error: null }); await pendingSave; });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("buyer_plan_lines", { p_plan_id: 8 }));
  });

  it("keeps totals, costs, and receipts on the plan whose lines are visible", async () => {
    type RpcRows = { data: Array<Record<string, unknown>>; error: null };
    const oldTotals = deferred<RpcRows>();
    const oldCosts = deferred<RpcRows>();
    const oldReceipts = deferred<RpcRows>();
    const plans = [plan, { ...plan, plan_id: 8, name: "Next trip" }];
    const total = (spent: number) => ({
      source: "shared-shop", total_lines: 1, recorded_lines: 1, purchased_lines: 1,
      cards_bought: 1, card_value_jpy: spent, shipping_jpy: 0,
      other_costs_jpy: 0, spent_total_jpy: spent, agent_payout_jpy: 100,
    });
    rpc.mockImplementation((fn: string, args?: { p_plan_id?: number }) => {
      const planId = args?.p_plan_id;
      if (fn === "buyer_assigned_plans") return Promise.resolve({ data: plans, error: null });
      if (fn === "buyer_plan_lines") {
        return Promise.resolve({ data: [line(planId === 8 ? 81 : 71, "shared-shop")], error: null });
      }
      if (fn === "buyer_source_totals") {
        return planId === 7
          ? oldTotals.promise
          : Promise.resolve({ data: [total(2222)], error: null });
      }
      if (fn === "buyer_source_costs") {
        return planId === 7
          ? oldCosts.promise
          : Promise.resolve({
              data: [{ source: "shared-shop", kind: "shipping", amount_jpy: 222, note: null }],
              error: null,
            });
      }
      if (fn === "buyer_source_receipts") {
        return planId === 7
          ? oldReceipts.promise
          : Promise.resolve({
              data: [{
                receipt_id: 8, source: "shared-shop", storage_path: "new/receipt",
                original_name: "new.pdf", uploaded_at: "2026-09-10T00:00:00Z",
              }],
              error: null,
            });
      }
      return Promise.resolve({ data: null, error: null });
    });

    render(<BuyerOrderView />);
    await waitFor(() => expect(document.querySelector('[data-cell="71:note"]')).toBeTruthy());
    fireEvent.change(screen.getByLabelText("buyer.purchaseList"), { target: { value: "8" } });
    await waitFor(() => expect(document.querySelector('[data-cell="81:note"]')).toBeTruthy());
    const header = screen.getByRole("heading", { name: "shared-shop" }).closest("header")!;
    await waitFor(() => expect(within(header).getByText("¥2,222")).toBeTruthy());
    expect(within(header).getByRole("button", { name: /buyer\.costShipping ¥222/ })).toBeTruthy();
    expect(within(header).getByText("buyer.receiptCount 1")).toBeTruthy();

    await act(async () => {
      oldTotals.resolve({ data: [total(1111)], error: null });
      oldCosts.resolve({
        data: [{ source: "shared-shop", kind: "shipping", amount_jpy: 111, note: null }],
        error: null,
      });
      oldReceipts.resolve({
        data: [
          { receipt_id: 71, source: "shared-shop", storage_path: "old/one", original_name: "one.pdf", uploaded_at: "2026-09-09T00:00:00Z" },
          { receipt_id: 72, source: "shared-shop", storage_path: "old/two", original_name: "two.pdf", uploaded_at: "2026-09-09T00:00:00Z" },
        ],
        error: null,
      });
      await Promise.all([oldTotals.promise, oldCosts.promise, oldReceipts.promise]);
    });

    expect(within(header).getByText("¥2,222")).toBeTruthy();
    expect(within(header).queryByText("¥1,111")).toBeNull();
    expect(within(header).getByRole("button", { name: /buyer\.costShipping ¥222/ })).toBeTruthy();
    expect(within(header).queryByRole("button", { name: /buyer\.costShipping ¥111/ })).toBeNull();
    expect(within(header).getByText("buyer.receiptCount 1")).toBeTruthy();
    expect(within(header).queryByText("buyer.receiptCount 2")).toBeNull();
  });

  it("does not refresh the prior plan after its flushed autosave succeeds", async () => {
    const plans = [plan, { ...plan, plan_id: 8, name: "Next trip" }];
    rpc.mockImplementation((fn: string, args?: { p_plan_id?: number }) => {
      if (fn === "buyer_assigned_plans") return Promise.resolve({ data: plans, error: null });
      if (fn === "buyer_plan_lines") {
        return Promise.resolve({ data: [line(args?.p_plan_id ?? 7, "shared-shop")], error: null });
      }
      if (fn === "buyer_source_totals") {
        return Promise.resolve({ data: [{
          source: "shared-shop", total_lines: 1, recorded_lines: 0, purchased_lines: 0,
          cards_bought: 0, card_value_jpy: 0, shipping_jpy: 0,
          other_costs_jpy: 0, spent_total_jpy: args?.p_plan_id === 8 ? 800 : 700,
          agent_payout_jpy: 0,
        }], error: null });
      }
      return Promise.resolve({ data: [], error: null });
    });

    render(<BuyerOrderView />);
    await waitFor(() => expect(document.querySelector('[data-cell="7:note"]')).toBeTruthy());
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("buyer_source_totals", { p_plan_id: 7 }));
    rpc.mockClear();

    fireEvent.change(document.querySelector('[data-cell="7:note"]')!, {
      target: { value: "save before switching" },
    });
    fireEvent.change(screen.getByLabelText("buyer.purchaseList"), { target: { value: "8" } });
    await waitFor(() => expect(document.querySelector('[data-cell="8:note"]')).toBeTruthy());
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("buyer_source_totals", { p_plan_id: 8 }));
    await act(async () => { await new Promise((done) => setTimeout(done, 700)); });

    const totalPlanIds = rpc.mock.calls
      .filter(([fn]) => fn === "buyer_source_totals")
      .map(([, args]) => args.p_plan_id);
    expect(totalPlanIds).toContain(8);
    expect(totalPlanIds).not.toContain(7);
  });
});
