// @vitest-environment jsdom
//
// Sending a plan to a person is a deliberate act. It used to happen as a side
// effect of picking a name from a dropdown, and the only thing on screen was a
// green "Sent" badge computed from `status !== "draft"` - true before the
// operator had touched anything, and naming no moment at all.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  plans: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ fn: string; args: unknown }>,
  rpcError: null as { message: string } | null,
  assigned: [] as unknown[],
}));

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (k: string, p?: Record<string, string>) => (p?.name ? `${k}:${p.name}` : k),
  }),
}));
vi.mock("./TripContext", () => ({ useTrips: () => ({ trips: [], activeTripId: null }) }));
vi.mock("./use-query", () => ({
  useSupabaseQuery: () => ({
    data: { plans: mocks.plans, lines: [], allocations: [], coverage: [] },
    error: null, isLoading: false, retry: vi.fn(),
  }),
  QueryError: () => null,
}));

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
    rpc: (fn: string, args: unknown) => {
      mocks.calls.push({ fn, args });
      if (fn === "assignable_buyers") {
        return Promise.resolve({
          data: [{ email: "agent@example.test", has_account: true, last_sign_in: null }],
          error: null,
        });
      }
      if (fn === "send_purchase_plan" || fn === "recall_purchase_plan") {
        return Promise.resolve({ data: null, error: mocks.rpcError });
      }
      return Promise.resolve({ data: [], error: null });
    },
    from: () => ({
      ...chain(),
      update: (patch: unknown) => ({
        eq: () => { mocks.assigned.push(patch); return Promise.resolve({ error: null }); },
      }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  }),
}));

import PurchasePlannerView from "./PurchasePlannerView";

const base = {
  plan_id: 1, name: "August trip", trip_id: null, line_count: 2, want_count: 0,
  budget_currency: "JPY", budget_amount: null, notes: null,
  created_at: "2026-09-01T00:00:00Z", reviewed_at: null, ordered_at: null,
};

afterEach(cleanup);
beforeEach(() => {
  mocks.calls = [];
  mocks.assigned = [];
  mocks.rpcError = null;
  mocks.plans = [{ ...base, status: "ready", assigned_buyer_email: "agent@example.test", sent_at: null }];
});

const sendButton = () => screen.findByRole("button", { name: "Send to buyer" });

describe("sending a plan to the buying agent", () => {
  it("offers a send button once an agent is chosen", async () => {
    render(<PurchasePlannerView />);
    expect(await sendButton()).toBeTruthy();
  });

  it("does not send merely because a name was picked", async () => {
    render(<PurchasePlannerView />);
    await sendButton();
    expect(mocks.calls.some((c) => c.fn === "send_purchase_plan")).toBe(false);
    expect(screen.getByText("Not on his screen until you send it")).toBeTruthy();
  });

  it("sends when the button is pressed, and only then", async () => {
    render(<PurchasePlannerView />);
    fireEvent.click(await sendButton());
    await waitFor(() =>
      expect(mocks.calls).toContainEqual({ fn: "send_purchase_plan", args: { p_plan_id: 1 } }),
    );
  });

  it("will not send to nobody", async () => {
    mocks.plans = [{ ...base, status: "ready", assigned_buyer_email: null, sent_at: null }];
    render(<PurchasePlannerView />);
    const button = await sendButton();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Choose a buying agent first")).toBeTruthy();
  });

  it("shows when it was sent, not merely that the status moved on", async () => {
    mocks.plans = [{
      ...base, status: "ready", assigned_buyer_email: "agent@example.test",
      sent_at: "2026-09-07T02:00:00Z",
    }];
    render(<PurchasePlannerView />);
    expect(await screen.findByText(/^Sent /)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send to buyer" })).toBeNull();
  });

  it("does not call a plan sent just because it left draft", async () => {
    // The old badge was `status !== "draft"`, which was true here.
    mocks.plans = [{ ...base, status: "ordered", assigned_buyer_email: "agent@example.test", sent_at: null }];
    render(<PurchasePlannerView />);
    await screen.findByText("Not on his screen until you send it");
    expect(screen.queryByText(/^Sent /)).toBeNull();
  });

  it("offers recall on a sent plan and reports the database's refusal", async () => {
    mocks.plans = [{
      ...base, status: "ordered", assigned_buyer_email: "agent@example.test",
      sent_at: "2026-09-07T02:00:00Z",
    }];
    mocks.rpcError = { message: "plan 1 cannot be recalled: he has already recorded 3 lines" };
    render(<PurchasePlannerView />);
    fireEvent.click(await screen.findByRole("button", { name: "Recall" }));
    expect(await screen.findByText(/already recorded 3 lines/)).toBeTruthy();
  });

  it("still shows who has the plan once it is ordered", async () => {
    // This is exactly when the operator needs it: the agent is out shopping.
    mocks.plans = [{
      ...base, status: "ordered", assigned_buyer_email: "agent@example.test",
      sent_at: "2026-09-07T02:00:00Z",
    }];
    render(<PurchasePlannerView />);
    expect(await screen.findByText("Buying agent")).toBeTruthy();

    // Visible, but frozen: guard_purchase_plan_mutation refuses the reassign,
    // so offering it would only produce an error the operator cannot act on.
    const option = await screen.findByRole("option", { name: "Nobody yet" });
    const select = option.closest("select") as HTMLSelectElement;
    expect(select.value).toBe("agent@example.test");
    expect(select.disabled).toBe(true);
  });
});
