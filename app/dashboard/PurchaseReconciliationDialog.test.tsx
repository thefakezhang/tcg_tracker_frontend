// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseReconciliationDialog } from "./PurchaseReconciliationDialog";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc, storage: { from: () => ({ download: mocks.download }) } }) }));
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const initial = {
  finalized: false, plan: { plan_id: 7, name: "Dated purchases" },
  sources: [{ source: "cardrush", card_value_jpy: 2000, handling_jpy: 60, line_fee_jpy: 100, shipping_jpy: 110, other_costs_jpy: 50, direct_total_usd: null, expense_total_usd: null }],
  lines: [{ plan_line_id: 71, item_name: "Fixture card", source: "cardrush", standing: true, game: "pokemon", purchased_quantity: 2, unit_price_jpy: 1000, condition_id: null, condition_seen: "NM" }],
  condition_options: [{ condition_id: 1, standard: "TCGplayer", code: "NM" }],
  blockers: ["purchase_inputs_required", "condition_review_required"], warnings: ["receipt_missing:cardrush"],
};
const ready = { ...initial, can_finalize: true, review_digest: "review-one", blockers: [], sources: [{ ...initial.sources[0], direct_total_usd: 13.33, expense_total_usd: 2.13 }] };
const done = { finalized: true, inventory_finalized: true, plan: initial.plan, lots: [{ lot_id: 42, source: "cardrush", acquired_at: "2026-07-01", landed_cost_usd: 15.46 }] };
const props = () => ({ planId: 7, open: true, onOpenChange: vi.fn(), onFinalized: vi.fn() });
function fill() {
  for (const [label, value] of [["purchaseDate", "2026-07-01"], ["fxRate", "150"], ["fxReference", "Purchase-date bank rate"], ["receiptTotal", "2160"]]) {
    fireEvent.change(screen.getByLabelText(`reconciliation.${label}`), { target: { value } });
  }
  fireEvent.change(screen.getByLabelText("reconciliation.condition"), { target: { value: "1" } });
}
async function reviewed() {
  await screen.findByText("Fixture card"); fill();
  fireEvent.click(screen.getByRole("button", { name: "reconciliation.reviewCosts" }));
  await screen.findByLabelText("reconciliation.acknowledge");
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => Promise.resolve({ error: null,
    data: name === "reconcile_purchase_plan_inventory" ? done : args.p_sources ? ready : initial }));
});
afterEach(cleanup);

describe("operator dated inventory review", () => {
  it("requires explicit historical inputs and warning acknowledgement before atomic finalization", async () => {
    const input = props(); render(<PurchaseReconciliationDialog {...input} />);
    await screen.findByText("Fixture card");
    expect(screen.getByLabelText("reconciliation.purchaseDate")).toHaveProperty("value", "");
    expect(screen.getByLabelText("reconciliation.fxRate")).toHaveProperty("value", "");
    expect(screen.getByRole("button", { name: "reconciliation.finalize" })).toHaveProperty("disabled", true);
    await reviewed();
    expect(screen.getByRole("button", { name: "reconciliation.finalize" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByLabelText("reconciliation.acknowledge"));
    fireEvent.click(screen.getByRole("button", { name: "reconciliation.finalize" }));
    await screen.findByText("reconciliation.success");
    expect(mocks.rpc).toHaveBeenLastCalledWith("reconcile_purchase_plan_inventory", {
      p_plan_id: 7, p_review_digest: "review-one", p_conditions: { "71": 1 }, p_acknowledge_warnings: true,
      p_sources: [{ source: "cardrush", purchased_on: "2026-07-01", jpy_per_usd: 150, rate_reference: "Purchase-date bank rate", receipt_total_jpy: 2160 }],
    });
    expect(input.onFinalized).toHaveBeenCalledTimes(1);
  });
  it("invalidates reviewed costs and acknowledgement as soon as an input changes", async () => {
    render(<PurchaseReconciliationDialog {...props()} />); await reviewed();
    fireEvent.click(screen.getByLabelText("reconciliation.acknowledge"));
    fireEvent.change(screen.getByLabelText("reconciliation.fxRate"), { target: { value: "151" } });
    expect(screen.getByRole("button", { name: "reconciliation.finalize" })).toHaveProperty("disabled", true);
    expect(screen.queryByLabelText("reconciliation.acknowledge")).toBeNull();
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "reconcile_purchase_plan_inventory")).toHaveLength(0);
  });
  it("preserves inputs after a lost response and reloads retained success without a second mutation", async () => {
    const input = props(); render(<PurchaseReconciliationDialog {...input} />); await reviewed();
    mocks.rpc.mockResolvedValueOnce({ error: { code: "NETWORK", message: "response lost" } });
    fireEvent.click(screen.getByLabelText("reconciliation.acknowledge"));
    fireEvent.click(screen.getByRole("button", { name: "reconciliation.finalize" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("reconciliation.fxRate")).toHaveProperty("value", "150");
    expect(screen.getByRole("button", { name: "reconciliation.finalize" })).toHaveProperty("disabled", true);
    mocks.rpc.mockResolvedValueOnce({ data: done, error: null });
    fireEvent.click(screen.getByRole("button", { name: "reconciliation.reviewCosts" }));
    await screen.findByText("reconciliation.success");
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "reconcile_purchase_plan_inventory")).toHaveLength(1);
  });
  it("ignores a stale read when the selected plan changes", async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.rpc.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    const input = props(); const view = render(<PurchaseReconciliationDialog {...input} />);
    mocks.rpc.mockResolvedValueOnce({ data: { ...initial, plan: { plan_id: 8, name: "Other plan" } }, error: null });
    view.rerender(<PurchaseReconciliationDialog {...input} planId={8} />);
    await screen.findByText(/Other plan/);
    await act(async () => resolveOld({ data: done, error: null }));
    expect(screen.queryByText("reconciliation.success")).toBeNull();
    expect(screen.getByText(/Other plan/)).toBeTruthy();
  });
  it("renders a transient read failure inline and allows an explicit retry", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: "network unavailable" } });
    render(<PurchaseReconciliationDialog {...props()} />);
    expect((await screen.findByRole("alert")).textContent).toContain("network unavailable");
    expect(screen.queryByRole("button", { name: "reconciliation.finalize" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    await waitFor(() => expect(screen.getByText("Fixture card")).toBeTruthy());
  });
  for (const failure of [
    { error: { code: "PGRST301", message: "JWT expired" }, title: "common.sessionExpired", expired: true },
    { error: { message: "session missing" }, status: 401, title: "common.sessionExpired", expired: true },
    { error: { message: "permission denied" }, status: 403, title: "common.accessDenied", expired: false },
  ]) {
    for (const stage of ["load", "review", "finalize"] as const) {
      it(`shows localized ${failure.title} for ${stage} and does not retry a denied write`, async () => {
        const input = props();
        if (stage === "load") mocks.rpc.mockResolvedValueOnce(failure);
        render(<PurchaseReconciliationDialog {...input} />);
        if (stage === "review") {
          await screen.findByText("Fixture card"); fill();
          mocks.rpc.mockResolvedValueOnce(failure);
          fireEvent.click(screen.getByRole("button", { name: "reconciliation.reviewCosts" }));
        }
        if (stage === "finalize") {
          await reviewed();
          mocks.rpc.mockResolvedValueOnce(failure);
          fireEvent.click(screen.getByLabelText("reconciliation.acknowledge"));
          fireEvent.click(screen.getByRole("button", { name: "reconciliation.finalize" }));
        }
        expect((await screen.findByRole("alert")).textContent).toContain(failure.title);
        if (failure.expired) expect(screen.getByRole("link", { name: "common.signInAgain" }).getAttribute("href")).toBe("/login");
        else expect(screen.queryByRole("link", { name: "common.signInAgain" })).toBeNull();
        if (stage !== "load") {
          expect(screen.getByLabelText("reconciliation.fxRate")).toHaveProperty("value", "150");
          expect(screen.getByRole("button", { name: "reconciliation.finalize" })).toHaveProperty("disabled", true);
          expect(screen.getByRole("button", { name: "reconciliation.reviewCosts" })).toHaveProperty("disabled", true);
        }
        expect(input.onFinalized).not.toHaveBeenCalled();
        expect(mocks.rpc.mock.calls.filter(([name]) => name === "reconcile_purchase_plan_inventory")).toHaveLength(stage === "finalize" ? 1 : 0);
      });
    }
  }
  for (const statusCode of ["401", "403"]) {
    it(`classifies Storage ${statusCode} without losing the entered evidence`, async () => {
      mocks.rpc.mockResolvedValueOnce({ data: { ...initial, receipts: [{ receipt_id: 1, source: "cardrush", storage_path: "plan-receipts/7/cardrush/fixture.pdf", original_name: "fixture.pdf" }] }, error: null });
      mocks.download.mockResolvedValueOnce({ error: { name: "StorageApiError", statusCode, message: "receipt unavailable" } });
      render(<PurchaseReconciliationDialog {...props()} />);
      await screen.findByText("Fixture card"); fill();
      fireEvent.click(screen.getByRole("button", { name: "reconciliation.receipt · fixture.pdf" }));
      expect((await screen.findByRole("alert")).textContent).toContain(statusCode === "401" ? "common.sessionExpired" : "common.accessDenied");
      expect(screen.getByLabelText("reconciliation.fxRate")).toHaveProperty("value", "150");
      expect(screen.getByRole("button", { name: "reconciliation.reviewCosts" })).toHaveProperty("disabled", true);
      expect(mocks.download).toHaveBeenCalledWith("plan-receipts/7/cardrush/fixture.pdf");
    });
  }

});
