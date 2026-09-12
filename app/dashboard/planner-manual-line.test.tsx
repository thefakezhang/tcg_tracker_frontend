// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("./TripContext", () => ({ useTrips: () => ({ trips: [], activeTripId: -14 }) }));
vi.mock("./use-query", async (importOriginal) => ({
  ...await importOriginal<typeof import("./use-query")>(),
  useSupabaseQuery: () => ({
    data: { plans: [{ plan_id: 1, name: "P", status: "draft", trip_id: null, line_count: 0, want_count: 0 }], lines: [], allocations: [], coverage: [] },
    error: null, isLoading: false, retry: vi.fn(),
  }),
  QueryError: () => null,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: () => Promise.resolve({ data: [], error: null }),
    from: () => ({
      select: () => ({ order: () => Promise.resolve({ data: [], error: null }), eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
      insert: () => Promise.resolve({ error: null }),
    }),
  }),
}));

import PurchasePlannerView from "./PurchasePlannerView";

afterEach(cleanup);

async function openManualEntry() {
  render(<PurchasePlannerView />);
  fireEvent.click(await screen.findByText("purchasePlanner.addLine"));
  fireEvent.click(await screen.findByText(/Enter a listing manually/));
}

describe("adding a line by hand", () => {
  it("says a card is still needed instead of a dead button", async () => {
    // The operator fills in the shop, the price and the listing URL, and the
    // Add button never lights up: it also requires a card, and nothing on
    // screen said so.
    await openManualEntry();
    fireEvent.change(screen.getByLabelText("purchasePlanner.unitPrice"), { target: { value: "11200" } });

    const add = screen.getAllByRole("button", { name: "purchasePlanner.addLine" }).pop() as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.getByText(/choose a card/i), "nothing tells the operator what is missing").toBeTruthy();
  });

  it("points the Add button at the reason it is disabled", async () => {
    // A dead control with no explanation is the whole complaint; the button
    // must name what it is waiting for to anyone reading it, screen reader
    // included.
    await openManualEntry();
    const add = screen.getAllByRole("button", { name: "purchasePlanner.addLine" }).pop() as HTMLButtonElement;
    const described = add.getAttribute("aria-describedby");
    expect(described, "disabled button explains nothing").toBeTruthy();
    expect(document.getElementById(described!)?.textContent).toMatch(/choose a card/i);
  });

  it("associates every manual field with its label", async () => {
    // Found because the test could not reach the price field the way an
    // operator would.
    await openManualEntry();
    for (const label of ["purchasePlanner.source", "purchasePlanner.unitPrice", "purchasePlanner.listingUrl"]) {
      expect(screen.getByLabelText(label), `${label} is not associated with a control`).toBeTruthy();
    }
  });
});
