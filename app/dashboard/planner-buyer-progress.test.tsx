// @vitest-environment jsdom
//
// The operator watching the agent shop. The strip used to load once and never
// look again, so the number on screen was whatever was true when the tab was
// opened, while the agent was out spending against it.

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  plans: [] as Array<Record<string, unknown>>,
  progress: null as Record<string, unknown> | null,
  shops: [] as Array<Record<string, unknown>>,
  progressReads: 0,
}));

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("./TripContext", () => ({ useTrips: () => ({ trips: [], activeTripId: null }) }));
vi.mock("./use-query", () => ({
  useSupabaseQuery: () => ({
    data: { plans: mocks.plans, lines: [], allocations: [], coverage: [] },
    error: null, isLoading: false, retry: vi.fn(),
  }),
  QueryError: () => null,
}));

function chain(table: string): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  const self = () => c;
  Object.assign(c, {
    select: self, order: self, eq: self, in: self, limit: self, single: self,
    maybeSingle: () => {
      if (table === "purchase_plan_progress_v") {
        mocks.progressReads += 1;
        return Promise.resolve({ data: mocks.progress, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    then: (res: (v: { data: unknown[]; error: null }) => unknown) =>
      res({ data: table === "purchase_plan_source_progress_v" ? mocks.shops : [], error: null }),
  });
  return c;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: () => Promise.resolve({ data: [], error: null }),
    from: (table: string) => ({
      ...chain(table),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  }),
}));

import PurchasePlannerView from "./PurchasePlannerView";

afterEach(() => { cleanup(); vi.useRealTimers(); });

beforeEach(() => {
  mocks.progressReads = 0;
  mocks.plans = [{
    plan_id: 1, name: "August trip", status: "ordered", trip_id: null,
    line_count: 4, want_count: 0, budget_currency: "JPY", budget_amount: null,
    notes: null, created_at: "2026-09-01T00:00:00Z", reviewed_at: null,
    ordered_at: "2026-09-06T00:00:00Z", assigned_buyer_email: "agent@example.test",
    sent_at: "2026-09-06T00:00:00Z",
  }];
  mocks.progress = {
    purchased_lines: 3, open_lines: 1, unavailable_lines: 0, cards_bought: 7,
    card_value_jpy: 100940, projected_handling_jpy: 3028,
    projected_line_fee_jpy: 300, projected_total_jpy: 104268,
    budget_amount: null, budget_currency: "JPY",
  };
  mocks.shops = [{
    source: "snkrdunk", total_lines: 4, recorded_lines: 4, purchased_lines: 3,
    cards_bought: 6, card_value_jpy: 100940, shipping_jpy: 900,
    other_costs_jpy: 220, agent_payout_jpy: 3328, spent_total_jpy: 105388,
  }];
});

describe("the operator watching the buyer", () => {
  it("breaks the spend down by shop, where the agent actually checks out", async () => {
    render(<PurchasePlannerView />);
    expect(await screen.findByText("snkrdunk")).toBeTruthy();
    // Shipping and his fee are per shop: he enters shipping at each counter.
    expect(screen.getByText("JPY 900")).toBeTruthy();
    expect(screen.getByText("JPY 3,328")).toBeTruthy();
    expect(screen.getByText("JPY 105,388")).toBeTruthy();
    // Worked through, versus actually bought: two different questions.
    expect(screen.getByText("4/4")).toBeTruthy();
  });

  it("keeps looking, because the agent is still shopping", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<PurchasePlannerView />);
    await waitFor(() => expect(mocks.progressReads).toBeGreaterThan(0));
    const first = mocks.progressReads;
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    expect(mocks.progressReads).toBeGreaterThan(first);
  });

  it("catches up when the operator comes back to the window", async () => {
    render(<PurchasePlannerView />);
    await waitFor(() => expect(mocks.progressReads).toBeGreaterThan(0));
    const first = mocks.progressReads;
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(mocks.progressReads).toBeGreaterThan(first));
  });
});
