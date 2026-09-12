// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn((_name?: string) => Promise.resolve({ data: [], error: null }));
const from = vi.fn((_table?: string) => ({
  select: () => ({
    order: () => Promise.resolve({ data: [], error: null }),
    eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
  }),
  insert: () => Promise.resolve({ error: null }),
}));
const retry = vi.fn();

vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./TripContext", () => ({ useTrips: () => ({ trips: [], activeTripId: -14 }) }));
vi.mock("./use-query", async (importOriginal) => ({
  ...await importOriginal<typeof import("./use-query")>(),
  useSupabaseQuery: () => ({
    data: {
      plans: [{ plan_id: 1, name: "P", status: "draft", trip_id: null, line_count: 0, want_count: 0 }],
      lines: [],
      allocations: [],
      coverage: [],
    },
    error: null,
    isLoading: false,
    retry: vi.fn(),
  }),
  QueryError: () => null,
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc, from }) }));
vi.mock("./sealed-planning-readiness", () => ({
  useSealedPlanningReadiness: () => ({ state: "unavailable", error: undefined, retry }),
  SealedPlanningReadinessNotice: ({ id }: { id: string }) => (
    <div id={id} role="status">sealed planning unavailable</div>
  ),
}));

import PurchasePlannerView from "./PurchasePlannerView";

afterEach(() => {
  cleanup();
  rpc.mockClear();
  from.mockClear();
  retry.mockClear();
});

describe("sealed planner schema readiness", () => {
  it("disables sealed catalog and manual planning controls without mutating", async () => {
    render(<PurchasePlannerView />);
    fireEvent.click(await screen.findByText("purchasePlanner.addLine"));
    fireEvent.click(screen.getByText(/Enter a listing manually/));

    const sealedOption = screen.getByRole("option", { name: "game.pokemon_sealed" });
    fireEvent.change(sealedOption.parentElement as HTMLSelectElement, {
      target: { value: "pokemon_sealed" },
    });

    expect(screen.getByRole("status").textContent).toContain("sealed planning unavailable");
    expect((screen.getByPlaceholderText("purchasePlanner.searchCatalog") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Hide manual entry/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("purchasePlanner.unitPrice").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    const add = screen.getAllByRole("button", { name: "purchasePlanner.addLine" }).pop() as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.getAttribute("aria-describedby")).toBe("planner-sealed-planning-readiness");
    expect(rpc.mock.calls.some(([name]) => name === "add_sealed_to_purchase_plan")).toBe(false);
    expect(from.mock.calls.some(([table]) => table === "purchase_plan_lines")).toBe(false);
  });
});
