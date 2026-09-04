// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  plans: [] as Array<Record<string, unknown>>,
  deleted: [] as number[],
  deleteError: null as { message: string } | null,
}));

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (k: string, p?: Record<string, string>) => (p?.name ? `${k}:${p.name}` : k),
  }),
}));
vi.mock("./TripContext", () => ({
  useTrips: () => ({ trips: [], activeTripId: null }),
}));
vi.mock("./use-query", () => ({
  useSupabaseQuery: () => ({
    data: { plans: mocks.plans, lines: [], allocations: [], coverage: [] },
    error: null, isLoading: false, retry: vi.fn(),
  }),
  QueryError: () => null,
}));
// A chainable stub: the planner reaches for several builder shapes, and a
// partial one fails as "eq is not a function" in whichever test renders the
// control that uses it.
function chain(): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  const self = () => c;
  Object.assign(c, {
    select: self, order: self, eq: self, in: self, limit: self, single: self,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (res: (v: { data: never[]; error: null }) => unknown) => res({ data: [], error: null }),
  });
  return c;
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: () => Promise.resolve({ data: [], error: null }),
    from: () => ({
      ...chain(),
      delete: () => ({
        eq: (_col: string, id: number) => {
          mocks.deleted.push(id);
          return Promise.resolve({ error: mocks.deleteError });
        },
      }),
    }),
  }),
}));

import PurchasePlannerView from "./PurchasePlannerView";

afterEach(cleanup);
beforeEach(() => {
  mocks.deleted = [];
  mocks.deleteError = null;
  mocks.plans = [{ plan_id: 1, name: "Typo", status: "draft", trip_id: null, line_count: 0, want_count: 0 }];
});

describe("deleting a purchase plan", () => {
  it("offers delete for a plan nothing has happened to", async () => {
    render(<PurchasePlannerView />);
    expect(await screen.findByRole("button", { name: "purchasePlanner.deletePlan" })).toBeTruthy();
  });

  it("asks before deleting, and names the plan", async () => {
    render(<PurchasePlannerView />);
    fireEvent.click(await screen.findByRole("button", { name: "purchasePlanner.deletePlan" }));
    // A plan is not recoverable, so it must not go on a single click.
    expect(await screen.findByText("purchasePlanner.deletePlanBody:Typo")).toBeTruthy();
    expect(mocks.deleted).toEqual([]);
  });

  it("deletes once confirmed", async () => {
    render(<PurchasePlannerView />);
    fireEvent.click(await screen.findByRole("button", { name: "purchasePlanner.deletePlan" }));
    const confirm = (await screen.findAllByRole("button", { name: "purchasePlanner.deletePlan" }))
      .find((b) => b.textContent === "purchasePlanner.deletePlan" && b.closest("[role=alertdialog]"));
    fireEvent.click(confirm!);
    await waitFor(() => expect(mocks.deleted).toEqual([1]));
  });

  it("does not offer delete once the plan is with the buyer", async () => {
    // The database refuses it - a placed plan cascades to the agent's recorded
    // purchases - so the button must not be there to be pressed.
    mocks.plans = [{ plan_id: 1, name: "Sent", status: "ordered", trip_id: null, line_count: 0, want_count: 0 }];
    render(<PurchasePlannerView />);
    await screen.findByText(/Sent/);
    expect(screen.queryByRole("button", { name: "purchasePlanner.deletePlan" })).toBeNull();
  });

  it("shows the database's reason when it refuses", async () => {
    mocks.deleteError = { message: "purchase plan 1 is ordered, so it cannot be deleted; cancel it instead" };
    render(<PurchasePlannerView />);
    fireEvent.click(await screen.findByRole("button", { name: "purchasePlanner.deletePlan" }));
    const confirm = (await screen.findAllByRole("button", { name: "purchasePlanner.deletePlan" }))
      .find((b) => b.closest("[role=alertdialog]"));
    fireEvent.click(confirm!);
    await waitFor(() => expect(screen.getByText(/cancel it instead/)).toBeTruthy());
  });
});
