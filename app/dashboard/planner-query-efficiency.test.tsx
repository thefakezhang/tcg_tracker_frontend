// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  reads: [] as { table: string; planId: number | null }[],
  holdPlan: null as number | null,
  release: null as (() => void) | null,
  deleted: false,
  created: false,
}));
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./TripContext", () => ({ useTrips: () => ({ trips: [] }) }));
vi.mock("./PurchaseReconciliationPanel", () => ({ default: () => null }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "operator" } }, error: null }) },
    rpc: async () => ({ data: [], error: null }),
    from: (table: string) => {
      let planId: number | null = null;
      let deleting = false;
      let inserting = false;
      const query = {
        select: () => query, order: () => query,
        insert: () => { inserting = true; return query; },
        single: () => query,
        delete: () => { deleting = true; return query; },
        eq: (_column: string, value: number) => { planId = value; return query; },
        then: async (resolve: (value: unknown) => unknown) => {
          if (inserting) { mock.created = true; return resolve({ data: { plan_id: 3 }, error: null }); }
          if (deleting) { mock.deleted = true; return resolve({ error: null }); }
          mock.reads.push({ table, planId });
          if (planId === mock.holdPlan && table === "purchase_plan_lines_v") {
            await new Promise<void>((done) => { mock.release = done; });
          }
          const data = table === "purchase_plans"
            ? (mock.created ? [3, 1, 2] : [1, 2]).filter((id) => !(mock.deleted && id === 1)).map((id) => ({ plan_id: id, name: `Plan ${id}`, status: "draft", trip_id: null }))
            : table === "purchase_plan_lines_v"
              ? [{ plan_line_id: planId, item_name: `Item ${planId}`, game: "pokemon", status: "planned", planned_quantity: 1, primary_quantity: 0, speculative_quantity: 1, landed_unit_cost_usd: 10 }]
              : [];
          return resolve({ data, error: null });
        },
      };
      return query;
    },
  }),
}));
import PurchasePlannerView from "./PurchasePlannerView";

function mount() {
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}><PurchasePlannerView /></SWRConfig>);
}
afterEach(cleanup);
beforeEach(() => { mock.reads = []; mock.holdPlan = null; mock.release = null; mock.deleted = false; mock.created = false; localStorage.clear(); });

describe("planner query work", () => {
  it("loads the plan list and selected details exactly once, then only new details on switch", async () => {
    mount();
    await screen.findByText("Item 1");
    expect(mock.reads.filter(({ table }) => table.startsWith("purchase_plan"))).toHaveLength(4);
    fireEvent.change(screen.getByLabelText("purchasePlanner.planPicker"), { target: { value: "2" } });
    await screen.findByText("Item 2");
    expect(mock.reads.filter(({ table }) => table === "purchase_plans")).toHaveLength(1);
    expect(mock.reads.filter(({ planId }) => planId === 2)).toHaveLength(3);
  });

  it("does not show a previous plan's lines while the next details are loading", async () => {
    mount();
    await screen.findByText("Item 1");
    mock.holdPlan = 2;
    fireEvent.change(screen.getByLabelText("purchasePlanner.planPicker"), { target: { value: "2" } });
    await waitFor(() => expect(mock.release).not.toBeNull());
    expect(screen.queryByText("Item 1")).toBeNull();
    await act(async () => { mock.release?.(); });
    await screen.findByText("Item 2");
  });

  it("selects a newly created plan after refreshing the plan list", async () => {
    mount();
    await screen.findByText("Item 1");
    fireEvent.click(screen.getByRole("button", { name: "purchasePlanner.newPlan" }));
    fireEvent.change(await screen.findByLabelText("purchasePlanner.planName"), { target: { value: "Plan 3" } });
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await screen.findByText("Item 3");
    expect((screen.getByLabelText("purchasePlanner.planPicker") as HTMLSelectElement).value).toBe("3");
  });

  it("refreshes the list after deletion and selects the remaining plan", async () => {
    mount();
    await screen.findByText("Item 1");
    fireEvent.click(screen.getByRole("button", { name: "purchasePlanner.deletePlan" }));
    const confirm = screen.getAllByRole("button", { name: "purchasePlanner.deletePlan" }).find((button) => button.closest("[role=alertdialog]"));
    fireEvent.click(confirm!);
    await screen.findByText("Item 2");
    expect(screen.queryByRole("option", { name: /Plan 1/ })).toBeNull();
    expect(mock.reads.filter(({ table }) => table === "purchase_plans").length).toBeGreaterThan(1);
  });
});
