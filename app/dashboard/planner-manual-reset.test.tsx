// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("./TripContext", () => ({ useTrips: () => ({ trips: [], activeTripId: -14 }) }));
vi.mock("./use-query", () => ({
  useSupabaseQuery: () => ({
    data: { plans: [{ plan_id: 1, name: "P", status: "draft", trip_id: null, line_count: 0, want_count: 0 }], lines: [], allocations: [], coverage: [] },
    error: null, isLoading: false, retry: vi.fn(),
  }),
  QueryError: () => null,
}));
vi.mock("@/lib/supabase/client", () => {
  const b: Record<string, unknown> = {};
  b.select = () => b; b.or = () => b; b.eq = () => b; b.order = () => b;
  b.limit = () => Promise.resolve({ data: [], error: null });
  b.insert = () => Promise.resolve({ error: null });
  b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r);
  return { createClient: () => ({ rpc: () => Promise.resolve({ data: [], error: null }), from: () => b }) };
});

import PurchasePlannerView from "./PurchasePlannerView";

afterEach(cleanup);

const openManual = async () => {
  fireEvent.click(await screen.findByText("purchasePlanner.addLine"));
  fireEvent.click(await screen.findByText(/Enter a listing manually/));
};

describe("the hand-entry fields between cards", () => {
  it("starts empty for the next card", async () => {
    // They used to survive the dialog closing, so the next card opened holding
    // the previous card's shop, price and LISTING URL. A stale per-listing URL
    // points the agent at a different card's listing, and a stale price has no
    // guard at all.
    render(<PurchasePlannerView />);
    await openManual();

    fireEvent.change(screen.getByLabelText("purchasePlanner.source"), { target: { value: "snkrdunk" } });
    fireEvent.change(screen.getByLabelText("purchasePlanner.unitPrice"), { target: { value: "3699" } });
    fireEvent.change(screen.getByLabelText("purchasePlanner.listingUrl"), {
      target: { value: "https://snkrdunk.com/apparels/107574/used/49476696" },
    });

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("purchasePlanner.unitPrice")).toBeNull());

    await openManual();
    expect((screen.getByLabelText("purchasePlanner.source") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("purchasePlanner.unitPrice") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("purchasePlanner.listingUrl") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("purchasePlanner.quantity") as HTMLInputElement).value).toBe("1");
  });
});
