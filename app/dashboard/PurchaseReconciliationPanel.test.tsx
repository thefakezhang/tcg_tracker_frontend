// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "./LanguageContext";
import {
  readPendingPurchaseReconciliation,
  type PendingPurchaseReconciliation,
} from "@/lib/purchase-reconciliation-pending";
import type { PurchasePlan } from "@/lib/purchase-planning";

const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc, from }),
}));

import PurchaseReconciliationPanel, {
  type ReconciliationSourceFacts,
} from "./PurchaseReconciliationPanel";

const facts: ReconciliationSourceFacts[] = [{
  source: "cardrush",
  purchased_lines: 2,
  card_jpy: 10000,
  handling_jpy: 300,
  line_fee_jpy: 100,
  buyer_handling_jpy: 400,
  shipping_jpy: 900,
  payment_fee_jpy: 50,
  customs_jpy: 20,
  other_jpy: 30,
  total_jpy: 11400,
}];

const plan: PurchasePlan = {
  plan_id: 9,
  name: "October order",
  trip_id: 4,
  status: "ordered",
  assigned_buyer_email: "agent@example.com",
  budget_currency: "JPY",
  budget_amount: null,
  notes: null,
  created_at: "2026-10-01T00:00:00Z",
  reviewed_at: "2026-10-02T00:00:00Z",
  ordered_at: "2026-10-03T00:00:00Z",
};

function poolQuery(data: unknown = { available_jpy: 20000 }, error: unknown = null) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, {
    select: self,
    eq: self,
    maybeSingle: () => Promise.resolve({ data, error }),
  });
  return chain;
}

function Harness({ initialPending = null, currentPlan = plan }: {
  initialPending?: PendingPurchaseReconciliation | null;
  currentPlan?: PurchasePlan;
}) {
  const [pending, setPending] = useState(initialPending);
  return (
    <LanguageProvider defaultLanguage="en">
      <PurchaseReconciliationPanel
        plan={currentPlan}
        trips={[{ trip_id: 4, name: "October Japan" }]}
        ownerId="operator-1"
        pending={pending}
        onPendingChange={setPending}
        onChanged={vi.fn()}
      />
    </LanguageProvider>
  );
}

async function ready() {
  await waitFor(() => expect(screen.getByLabelText("JPY per USD")).toBeTruthy());
  await waitFor(() => expect((screen.getByLabelText(/Card purchases/) as HTMLInputElement).value).toBe("0"));
}

function fillAuthoritativeInputs() {
  fireEvent.change(screen.getByLabelText("JPY per USD"), { target: { value: "150" } });
  fireEvent.change(screen.getByLabelText(/Card purchases/), { target: { value: "8000" } });
  fireEvent.change(screen.getByLabelText(/Buyer handling and line fees/), { target: { value: "400" } });
  fireEvent.change(screen.getByLabelText(/^Shipping \(/), { target: { value: "900" } });
}

beforeEach(() => {
  localStorage.clear();
  rpc.mockReset().mockImplementation((name: string) => {
    if (name === "buyer_float_effective_source_facts") {
      return Promise.resolve({ data: facts, error: null });
    }
    return Promise.resolve({ data: [], error: null });
  });
  from.mockReset().mockImplementation(() => poolQuery());
});

afterEach(cleanup);

describe("PurchaseReconciliationPanel", () => {
  it("starts every component at business cash and submits all six explicit components", async () => {
    let pendingWasDurableAtMutation = false;
    rpc.mockImplementation((name: string) => {
      if (name === "buyer_float_effective_source_facts") {
        return Promise.resolve({ data: facts, error: null });
      }
      pendingWasDurableAtMutation = readPendingPurchaseReconciliation("operator-1") != null;
      return Promise.resolve({ data: [], error: null });
    });
    render(<Harness />);
    await ready();

    expect((screen.getByLabelText("Acquisition trip") as HTMLSelectElement).value).toBe("4");
    expect((screen.getByLabelText("Effective source shipping (JPY)") as HTMLInputElement).value).toBe("900");
    expect(screen.getByText("Available buyer-float pool").parentElement?.textContent).toContain("¥20,000");
    expect(screen.getByText(/Business cash remainder/).textContent).toContain("¥11,400");

    fillAuthoritativeInputs();
    fireEvent.click(screen.getByRole("button", { name: "Reconcile plan" }));

    await waitFor(() => {
      const calls = rpc.mock.calls.filter(([name]) => name === "reconcile_purchase_plan");
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toEqual({
        p_request_id: expect.any(String),
        p_plan_id: 9,
        p_trip_id: 4,
        p_fx_rate: 150,
        p_shipping_jpy: { cardrush: 900 },
        p_float_funding_jpy: {
          cardrush: {
            card_jpy: 8000,
            buyer_handling_jpy: 400,
            shipping_jpy: 900,
            payment_fee_jpy: 0,
            customs_jpy: 0,
            other_jpy: 0,
          },
        },
      });
    });
    expect(pendingWasDurableAtMutation).toBe(true);
    expect(readPendingPurchaseReconciliation("operator-1")).toBeNull();
  });

  it("locks and replays the exact nested payload after an unknown outcome and reload", async () => {
    let unknown = true;
    rpc.mockImplementation((name: string) => {
      if (name === "buyer_float_effective_source_facts") {
        return Promise.resolve({ data: facts, error: null });
      }
      return Promise.resolve(unknown
        ? { data: null, error: { code: "57014", message: "response lost" } }
        : { data: [], error: null });
    });
    render(<Harness />);
    await ready();
    fillAuthoritativeInputs();
    fireEvent.click(screen.getByRole("button", { name: "Reconcile plan" }));

    expect((await screen.findByRole("alert")).textContent).toContain("response lost");
    const first = rpc.mock.calls.find(([name]) => name === "reconcile_purchase_plan")?.[1];
    const persisted = readPendingPurchaseReconciliation("operator-1");
    expect(persisted?.requestId).toBe(first?.p_request_id);
    expect((screen.getByLabelText("JPY per USD") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Effective source shipping (JPY)") as HTMLInputElement).disabled).toBe(true);

    cleanup();
    unknown = false;
    render(<Harness initialPending={persisted} />);
    const retry = await screen.findByRole("button", { name: "Retry exact reconciliation" });
    expect((screen.getByLabelText("JPY per USD") as HTMLInputElement).value).toBe("150");
    fireEvent.click(retry);

    await waitFor(() => {
      const calls = rpc.mock.calls.filter(([name]) => name === "reconcile_purchase_plan");
      expect(calls).toHaveLength(2);
      expect(calls[1][1]).toEqual(calls[0][1]);
    });
  });

  it("clears a definite rejection so the operator can correct the inputs", async () => {
    rpc.mockImplementation((name: string) => name === "buyer_float_effective_source_facts"
      ? Promise.resolve({ data: facts, error: null })
      : Promise.resolve({ data: null, error: { code: "P0001", message: "refund boundary incomplete" } }));
    render(<Harness />);
    await ready();
    fillAuthoritativeInputs();
    fireEvent.click(screen.getByRole("button", { name: "Reconcile plan" }));

    expect((await screen.findByRole("alert")).textContent).toContain("refund boundary incomplete");
    expect(readPendingPurchaseReconciliation("operator-1")).toBeNull();
    await waitFor(() => expect((screen.getByLabelText("JPY per USD") as HTMLInputElement).disabled).toBe(false));
  });

  it("enforces component ceilings and the buyer's available pool", async () => {
    from.mockImplementation(() => poolQuery({ available_jpy: 1000 }));
    render(<Harness />);
    await ready();
    fireEvent.change(screen.getByLabelText("JPY per USD"), { target: { value: "150" } });

    const card = screen.getByLabelText(/Card purchases/) as HTMLInputElement;
    fireEvent.change(card, { target: { value: "10001" } });
    expect(card.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("A buyer-float allocation exceeds its authoritative component maximum.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Reconcile plan" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(card, { target: { value: "1001" } });
    expect(screen.getByText("The buyer-float allocation exceeds the buyer's available pool.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Reconcile plan" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("refreshes changed facts and resets every allocation before mutation", async () => {
    let factReads = 0;
    rpc.mockImplementation((name: string) => {
      if (name !== "buyer_float_effective_source_facts") {
        return Promise.resolve({ data: [], error: null });
      }
      factReads += 1;
      return Promise.resolve({
        data: factReads === 1 ? facts : [{ ...facts[0], card_jpy: 9999, total_jpy: 11399 }],
        error: null,
      });
    });
    render(<Harness />);
    await ready();
    fillAuthoritativeInputs();
    fireEvent.click(screen.getByRole("button", { name: "Reconcile plan" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Source costs changed");
    expect((screen.getByLabelText(/Card purchases/) as HTMLInputElement).value).toBe("0");
    expect(rpc.mock.calls.filter(([name]) => name === "reconcile_purchase_plan")).toHaveLength(0);
  });

  it("uses labelled mobile-sized inputs and a mobile-sized submit target", async () => {
    render(<Harness />);
    await ready();
    expect(screen.getByLabelText("JPY per USD").className).toContain("min-h-12");
    expect(screen.getByLabelText(/Card purchases/).className).toContain("min-h-12");
    expect(screen.getByRole("button", { name: "Reconcile plan" }).className).toContain("min-h-12");
  });

  it("clears old-plan facts and blocks submission when the new plan read fails", async () => {
    const { rerender } = render(<Harness />);
    await ready();
    fireEvent.change(screen.getByLabelText("JPY per USD"), { target: { value: "150" } });
    rpc.mockImplementation((name: string) => name === "buyer_float_effective_source_facts"
      ? Promise.resolve({ data: null, error: { message: "new plan facts denied" } })
      : Promise.resolve({ data: [], error: null }));
    rerender(<Harness currentPlan={{ ...plan, plan_id: 10, name: "November order" }} />);

    expect((await screen.findByRole("alert")).textContent).toContain("new plan facts denied");
    expect(screen.queryByText("cardrush")).toBeNull();
    expect((screen.getByRole("button", { name: "Reconcile plan" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
