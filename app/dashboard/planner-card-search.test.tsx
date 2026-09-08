// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Records the or() filters the dialog sends, so we can assert the SEMANTICS
// rather than the row shape.
const mocks = vi.hoisted(() => ({ filters: [] as string[], table: "" }));

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
  const builder = () => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.or = (f: string) => { mocks.filters.push(f); return b; };
    b.eq = () => b;
    b.order = () => b;
    b.limit = () => Promise.resolve({ data: [], error: null });
    b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r);
    return b;
  };
  return {
    createClient: () => ({
      rpc: () => Promise.resolve({ data: [], error: null }),
      from: (t: string) => { if (t !== "purchase_plans") mocks.table = t; return builder(); },
    }),
  };
});

import PurchasePlannerView from "./PurchasePlannerView";

afterEach(cleanup);
beforeEach(() => { mocks.filters = []; mocks.table = ""; });

async function searchFor(term: string) {
  render(<PurchasePlannerView />);
  fireEvent.click(await screen.findByText("purchasePlanner.addLine"));
  const box = await screen.findByPlaceholderText(/search|検索/i).catch(() => null)
    ?? document.querySelector('input[type="search"], input:not([type])') as HTMLInputElement;
  fireEvent.change(box as HTMLElement, { target: { value: term } });
  await waitFor(() => expect(mocks.filters.length).toBeGreaterThan(0), { timeout: 3000 });
}

describe("the add-card search in the planner", () => {
  it("finds a card by its full UUID", async () => {
    // The one identifier that is unambiguous, and the one the UI itself shows.
    // This dialog carried its own matcher over name/set/number only, so a UUID
    // found nothing here while working on every other card surface.
    await searchFor("8a29d039-93e4-4719-abf3-7ef30eb0d5e4");
    expect(mocks.filters.join(" ")).toContain("card_uid.eq.8a29d039-93e4-4719-abf3-7ef30eb0d5e4");
  });

  it("finds a card by the 8-hex prefix the UI displays", async () => {
    await searchFor("8a29d039");
    const joined = mocks.filters.join(" ");
    expect(joined).toContain("card_uid.gte.8a29d039-0000-0000-0000-000000000000");
    expect(joined).toContain("card_uid.lte.8a29d039-ffff-ffff-ffff-ffffffffffff");
  });

  it("still searches names, and keeps multi-token AND", async () => {
    await searchFor("blastoise 009");
    // Two filters, applied in sequence: chained or() calls AND together.
    expect(mocks.filters.length).toBe(2);
    expect(mocks.filters[0]).toContain("blastoise");
    expect(mocks.filters[1]).toContain("009");
  });

  it("does not mix name columns into an identifier paste", async () => {
    await searchFor("8a29d039-93e4-4719-abf3-7ef30eb0d5e4");
    expect(mocks.filters.join(" ")).not.toContain("regional_name.ilike");
  });
});
