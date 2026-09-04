// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    rpc: () => Promise.resolve({ data: [], error: null }),
    from: () => ({
      select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            mocks.plans = [...mocks.plans, {
              plan_id: 3, name: row.name, status: "draft",
              trip_id: row.trip_id, line_count: 0, want_count: 0,
            }];
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
    // The rule the second effect existed to enforce, which must survive the fix.
    fireEvent.change(screen.getByLabelText("purchasePlanner.tripFilter"), { target: { value: "9" } });
    expect(screen.queryByText(/August/)).toBeNull();
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
    expect((screen.getByLabelText("purchasePlanner.tripFilter") as HTMLSelectElement).value).toBe("none");
  });
});
