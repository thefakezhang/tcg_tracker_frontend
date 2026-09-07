// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ plans: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
// -14 is the Purchase Planner's own VIEW SENTINEL. TripContext.activeTripId
// carries it, so on this view it is never a trip id - reaching this component
// at all means the value is negative.
vi.mock("./TripContext", () => ({
  useTrips: () => ({ trips: [{ trip_id: 8, name: "Trip 5 JP-US Sept 2026" }], activeTripId: -14 }),
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
    from: () => ({ select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
  }),
}));

import PurchasePlannerView from "./PurchasePlannerView";

afterEach(cleanup);
beforeEach(() => {
  mocks.plans = [
    { plan_id: 9, name: "Snkrdunk", status: "draft", trip_id: 8, line_count: 0, want_count: 0 },
    { plan_id: 8, name: "Test", status: "draft", trip_id: 8, line_count: 1, want_count: 0 },
    { plan_id: 6, name: "Untripped", status: "draft", trip_id: null, line_count: 0, want_count: 0 },
  ];
});

const planPicker = () =>
  Array.from(document.querySelectorAll("select"))
    .find((s) => Array.from(s.options).some((o) => /\[/.test(o.textContent ?? "")));

describe("the plan picker on the planner view", () => {
  it("lists plans even though activeTripId is this view's sentinel", () => {
    // The reported failure: the dropdown offered nothing at all. effectiveTrip
    // fell back to activeTripId, which is -14 here, and no plan has trip_id
    // -14, so every plan was filtered out and none could be selected.
    render(<PurchasePlannerView />);
    const picker = planPicker();
    expect(picker, "no plan picker rendered at all").toBeTruthy();
    expect(Array.from(picker!.options).map((o) => o.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Snkrdunk")]),
    );
    expect(picker!.options.length).toBe(3);
  });

  it("filters to one trip when asked", () => {
    render(<PurchasePlannerView />);
    fireEvent.change(screen.getByLabelText("purchasePlanner.tripFilter"), { target: { value: "8" } });
    expect(planPicker()!.options.length).toBe(2);
  });

  it("gives untripped plans their own bucket", () => {
    render(<PurchasePlannerView />);
    fireEvent.change(screen.getByLabelText("purchasePlanner.tripFilter"), { target: { value: "none" } });
    const opts = Array.from(planPicker()!.options).map((o) => o.textContent);
    expect(opts.length).toBe(1);
    expect(opts[0]).toContain("Untripped");
  });
});
