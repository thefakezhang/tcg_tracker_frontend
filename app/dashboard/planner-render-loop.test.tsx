// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPendingPurchaseReconciliation,
  writePendingPurchaseReconciliation,
} from "@/lib/purchase-reconciliation-pending";

// The operator makes a purchase plan and the planner dies with React error
// #185, "Maximum update depth exceeded".
const mocks = vi.hoisted(() => ({
  plans: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("./TripContext", () => ({
  // A trip filter that no plan matches - the operator is on September, and
  // every plan belongs somewhere else.
  useTrips: () => ({ trips: [{ trip_id: 9, name: "September" }], activeTripId: 9 }),
}));
vi.mock("./use-query", () => ({
  useSupabaseQuery: () => ({
    data: { plans: mocks.plans, lines: [], allocations: [], coverage: [] },
    error: null, isLoading: false, retry: vi.fn(),
  }),
  QueryError: () => null,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({
        data: { user: { id: "operator-1" } },
        error: null,
      }),
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
    from: () => ({
      select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            mocks.plans.push({
              plan_id: 3, name: row.name, status: "draft",
              trip_id: row.trip_id, line_count: 0, want_count: 0,
            });
            return Promise.resolve({ data: { plan_id: 3 }, error: null });
          },
        }),
      }),
    }),
  }),
}));

import PurchasePlannerView from "./PurchasePlannerView";

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  mocks.plans = [
    // The first plan of ALL plans belongs to a different trip than the filter.
    { plan_id: 1, name: "August", status: "draft", trip_id: 8, line_count: 0, want_count: 0 },
    { plan_id: 2, name: "No trip", status: "draft", trip_id: null, line_count: 0, want_count: 0 },
  ];
});

describe("purchase planner plan selection", () => {
  it("settles when the trip filter matches no plan", () => {
    // Two effects fighting: one re-selected from ALL plans whenever nothing was
    // selected, the other cleared anything outside the current trip. Each undid
    // the other, forever.
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(String(a[0])); });
    try {
      render(<PurchasePlannerView />);
    } finally {
      spy.mockRestore();
    }
    expect(errors.find((e) => /Maximum update depth/.test(e)),
      "planner rendered in an infinite setState loop").toBeUndefined();
  });

  it("does not select a plan the trip filter hides", () => {
    render(<PurchasePlannerView />);
    // The filter now starts at every plan and is the operator's own control -
    // it no longer falls back to activeTripId, which on this view is a VIEW
    // SENTINEL rather than a trip. So hiding has to be driven through the
    // control rather than assumed from the active trip.
    fireEvent.change(screen.getByLabelText("purchasePlanner.tripFilter"), { target: { value: "9" } });
    expect(screen.queryByText(/August/)).toBeNull();
  });

  it("blocks every new reconciliation while the pending plan is unavailable", async () => {
    writePendingPurchaseReconciliation(createPendingPurchaseReconciliation(
      "operator-1",
      {
        p_plan_id: 99,
        p_trip_id: 9,
        p_fx_rate: 150,
        p_shipping_jpy: { cardrush: 0 },
        p_float_funding_jpy: {
          cardrush: {
            card_jpy: 0,
            buyer_handling_jpy: 0,
            shipping_jpy: 0,
            payment_fee_jpy: 0,
            customs_jpy: 0,
            other_jpy: 0,
          },
        },
      },
      "a0d88f47-7d9d-4f6d-81b4-3dc7ad6f4570",
    ));

    render(<PurchasePlannerView />);

    expect((await screen.findByRole("alert")).textContent)
      .toContain("purchasePlanner.reconcile.pendingPlanUnavailable");
    expect(screen.queryByRole("button", { name: "purchasePlanner.reconcile.submit" })).toBeNull();
  });
});

describe("creating a plan", () => {
  it("shows the plan that was just created, whatever trip it belongs to", async () => {
    render(<PurchasePlannerView />);

    // Two controls open the dialog (toolbar and empty state); either will do.
    fireEvent.click(screen.getAllByRole("button", { name: "purchasePlanner.newPlan" })[0]);
    fireEvent.change(await screen.findByLabelText("purchasePlanner.planName"),
      { target: { value: "October" } });
    // Created with no trip, while the operator sits on September.
    fireEvent.change(screen.getByLabelText("Trip"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    // Without moving the filter the plan is created and immediately hidden,
    // which reads as the create having failed.
    await waitFor(() => expect(screen.getByText(/October/)).toBeTruthy());
  });
});
