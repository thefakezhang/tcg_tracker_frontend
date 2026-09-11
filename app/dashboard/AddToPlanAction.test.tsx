// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc, from }) }));
vi.mock("./TripContext", () => ({ useTrips: () => ({ activeTripId: 9, trips: [] }) }));
vi.mock("@/lib/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/i18n")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: Parameters<typeof actual.t>[1], params?: Record<string, string | number>) =>
        actual.t("en", key, params),
    }),
  };
});

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
      expect(Array.from(select.options, (option) => option.text)).toEqual([
        "October scouting [Draft]",
        "Other trip plan [Draft]",
      ]);
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
    fireEvent.change(screen.getByLabelText("Max price per copy for Iono"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Copies of Bede"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Max price per copy for Bede"), { target: { value: "60000" } });
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

    await screen.findByText("1 of 2 are on the plan");
    expect(screen.getByText(/Bede · no JPY listing on file/)).toBeTruthy();
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

  it("says when the chosen shop cannot cover the copies asked for", async () => {
    // The whole reason the count is captured. Silence here is what sends a
    // buyer to Japan holding an instruction that cannot be filled.
    rpc.mockResolvedValue({
      data: [{ card_id: 1, added: true, source: "shinsoku", asking_price: 300, available_quantity: 3, reason: null }],
      error: null,
    });
    render(<AddToPlanAction cards={[{ id: 1, name: "Iono" }]} />);
    fireEvent.click(screen.getByText("Add to plan"));
    await screen.findByText("Plan");

    fireEvent.change(screen.getByLabelText("Copies of Iono"), { target: { value: "20" } });
    fireEvent.click(screen.getByText(/^Add 20 copies$/));

    await screen.findByText("1 of 1 are on the plan");
    expect(screen.getByText(/shinsoku reports 3 of 20/)).toBeTruthy();
  });

  it("does not claim a shortfall when the shop publishes no count", async () => {
    // null is "did not say", not "has none". Treating it as zero would flag
    // every source we have not taught to read its own stock line.
    rpc.mockResolvedValue({
      data: [{ card_id: 1, added: true, source: "cardrush", asking_price: 300, available_quantity: null, reason: null }],
      error: null,
    });
    render(<AddToPlanAction cards={[{ id: 1, name: "Iono" }]} />);
    fireEvent.click(screen.getByText("Add to plan"));
    await screen.findByText("Plan");

    fireEvent.change(screen.getByLabelText("Copies of Iono"), { target: { value: "20" } });
    fireEvent.click(screen.getByText(/^Add 20 copies$/));

    await screen.findByText("1 of 1 are on the plan");
    expect(screen.queryByText(/does not have enough/)).toBeNull();
  });

  it("stays quiet when the shop has enough", async () => {
    rpc.mockResolvedValue({
      data: [{ card_id: 1, added: true, source: "shinsoku", asking_price: 300, available_quantity: 50, reason: null }],
      error: null,
    });
    render(<AddToPlanAction cards={[{ id: 1, name: "Iono" }]} />);
    fireEvent.click(screen.getByText("Add to plan"));
    await screen.findByText("Plan");

    fireEvent.change(screen.getByLabelText("Copies of Iono"), { target: { value: "20" } });
    fireEvent.click(screen.getByText(/^Add 20 copies$/));

    await screen.findByText("1 of 1 are on the plan");
    expect(screen.queryByText(/does not have enough/)).toBeNull();
  });

  it("sends the exact condition and edition for every sealed variant", async () => {
    rpc.mockResolvedValue({
      data: [
        { product_id: 41, sealed_condition: "shrink", variant_edition: "1ed", added: true, source: "cardrush", asking_price: 1200, available_quantity: null, reason: null },
        { product_id: 41, sealed_condition: "no_shrink", variant_edition: "unlimited", added: true, source: "hareruya2", asking_price: 800, available_quantity: null, reason: null },
      ],
      error: null,
    });
    render(<AddToPlanAction sealedProducts={[
      { id: 41, name: "Test Box", sealedCondition: "shrink", variantEdition: "1ed" },
      { id: 41, name: "Test Box", sealedCondition: "no_shrink", variantEdition: "unlimited" },
    ]} />);
    fireEvent.click(screen.getByText("Add to plan"));
    await screen.findByText("Plan");

    fireEvent.change(screen.getByLabelText("Copies of Test Box · 1st Edition · Shrink"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Max price per copy for Test Box · 1st Edition · Shrink"), { target: { value: "1500" } });
    fireEvent.click(screen.getByText("Add 4 copies"));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("add_sealed_to_purchase_plan", {
      p_plan_id: 5,
      p_items: [
        { product_id: 41, sealed_condition: "shrink", variant_edition: "1ed", quantity: 3, ceiling_jpy: 1500 },
        { product_id: 41, sealed_condition: "no_shrink", variant_edition: "unlimited", quantity: 1, ceiling_jpy: null },
      ],
    }));
    expect(await screen.findByText("2 of 2 are on the plan")).toBeTruthy();
    expect(screen.getByText(/Test Box · 1st Edition · Shrink/)).toBeTruthy();
    expect(screen.getByText(/Test Box · Unlimited · No Shrink/)).toBeTruthy();
  });

  it("retries only failed sealed selections and merges the new outcome", async () => {
    rpc
      .mockResolvedValueOnce({
        data: [
          { product_id: 41, sealed_condition: "shrink", variant_edition: "1ed", added: true, source: "cardrush", asking_price: 1200, available_quantity: null, reason: null },
          { product_id: 42, sealed_condition: "standard", variant_edition: "standard", added: false, source: null, asking_price: null, available_quantity: null, reason: "no eligible JPY listing on file" },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          { product_id: 42, sealed_condition: "standard", variant_edition: "standard", added: true, source: "shinsoku", asking_price: 900, available_quantity: null, reason: null },
        ],
        error: null,
      });
    render(<AddToPlanAction sealedProducts={[
      { id: 41, name: "Alpha Box", sealedCondition: "shrink", variantEdition: "1ed" },
      { id: 42, name: "Beta Box", sealedCondition: "standard", variantEdition: "standard" },
    ]} />);
    fireEvent.click(screen.getByText("Add to plan"));
    await screen.findByText("Plan");
    fireEvent.click(screen.getByText("Add 2 copies"));

    expect(await screen.findByText("1 of 2 are on the plan")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry 1 not added" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(rpc.mock.calls[1]).toEqual(["add_sealed_to_purchase_plan", {
      p_plan_id: 5,
      p_items: [{
        product_id: 42,
        sealed_condition: "standard",
        variant_edition: "standard",
        quantity: 1,
        ceiling_jpy: null,
      }],
    }]);
    expect(await screen.findByText("2 of 2 are on the plan")).toBeTruthy();
    expect(screen.queryByText("Retry 1 not added")).toBeNull();
  });

  it("treats a lost-response duplicate as already present instead of retryable", async () => {
    rpc
      .mockResolvedValueOnce({
        data: [{ product_id: 41, sealed_condition: "shrink", variant_edition: "1ed", added: false, source: null, asking_price: null, available_quantity: null, reason: "no eligible JPY listing on file" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ product_id: 41, sealed_condition: "shrink", variant_edition: "1ed", added: false, source: null, asking_price: null, available_quantity: null, reason: "already on this plan" }],
        error: null,
      });
    render(<AddToPlanAction sealedProducts={[
      { id: 41, name: "Alpha Box", sealedCondition: "shrink", variantEdition: "1ed" },
    ]} />);
    fireEvent.click(screen.getByText("Add to plan"));
    await screen.findByText("Plan");
    fireEvent.click(screen.getByText("Add 1 copy"));
    fireEvent.click(await screen.findByRole("button", { name: "Retry 1 not added" }));

    expect(await screen.findByText("1 of 1 are on the plan")).toBeTruthy();
    expect(screen.getByText(/Already on this plan/)).toBeTruthy();
    expect(screen.queryByText("Retry 1 not added")).toBeNull();
  });

  it("blocks invalid quantities instead of silently changing them to one", async () => {
    render(<AddToPlanAction sealedProducts={[
      { id: 41, name: "Alpha Box", sealedCondition: "shrink", variantEdition: "1ed" },
    ]} />);
    fireEvent.click(screen.getByText("Add to plan"));
    await screen.findByText("Plan");
    fireEvent.change(screen.getByLabelText("Copies of Alpha Box · 1st Edition · Shrink"), { target: { value: "0" } });

    expect(screen.getByRole("alert").textContent).toMatch(/whole-number quantity/);
    expect((screen.getByRole("button", { name: "Add 0 copies" }) as HTMLButtonElement).disabled).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("the target plan when a newer plan appears", () => {
  it("re-targets the newest plan on the active trip instead of keeping the old one", async () => {
    // The reported failure: make a plan, add a listing, and the listing lands
    // on the PREVIOUS plan while the new one stays empty.
    //
    // The dialog is never unmounted, so its target survived every plan created
    // after it was first chosen, and nothing on screen said which plan was
    // about to receive the cards.
    render(<AddToPlanAction cards={[{ id: 1, name: "Iono" }]} />);

    fireEvent.click(screen.getByText("Add to plan"));
    const picker = () => screen.getByLabelText("Plan") as HTMLSelectElement;
    await waitFor(() => expect(picker().value).toBe("5"));

    // Close it, and meanwhile the operator makes a new plan on the same trip.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Plan")).toBeNull());
    from.mockImplementation(() => plansResult([
      { plan_id: 9, name: "Snkrdunk", status: "draft", trip_id: 9 },
      { plan_id: 5, name: "October scouting", status: "draft", trip_id: 9 },
      { plan_id: 7, name: "Other trip plan", status: "draft", trip_id: 3 },
    ]));

    fireEvent.click(screen.getByText("Add to plan"));
    await waitFor(() => expect(picker().value).toBe("9"));
  });

  it("keeps a hand-picked plan for the rest of that open", async () => {
    render(<AddToPlanAction cards={[{ id: 1, name: "Iono" }]} />);
    fireEvent.click(screen.getByText("Add to plan"));
    const picker = () => screen.getByLabelText("Plan") as HTMLSelectElement;
    await waitFor(() => expect(picker().value).toBe("5"));

    // Choosing another trip's plan deliberately must not be undone underneath.
    fireEvent.change(picker(), { target: { value: "7" } });
    expect(picker().value).toBe("7");
  });
});
