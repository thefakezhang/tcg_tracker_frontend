// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lines: [] as Record<string, unknown>[] }));

vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: (name: string) => {
      if (name === "buyer_assigned_plans")
        return Promise.resolve({ data: [{ plan_id: 1, name: "P", status: "ready", line_count: mocks.lines.length, recorded_count: 0, finalized: false }], error: null });
      if (name === "buyer_plan_lines") return Promise.resolve({ data: mocks.lines, error: null });
      return Promise.resolve({ data: [], error: null });
    },
  }),
}));

import BuyerOrderView from "./BuyerOrderView";

const line = (id: number, qty: number) => ({
  plan_line_id: id, source: "snkrdunk", source_listing_url: "https://snkrdunk.com/apparels/1/used",
  planned_quantity: qty, unit_price_orig: 1000, currency: "JPY", source_observed_at: null,
  card_name: "テスト", card_english_name: "Test", set_code: "X", card_number: "1/1",
  image_url: null, want_id: null, want_max: null, want_filled: null, want_ceiling: null,
  outcome: "pending", purchased_quantity: 0, unit_price_jpy: null, condition_seen: null, note: null,
});

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => { mocks.lines = [line(1, 1)]; });

describe("when the operator changes the list he is shopping from", () => {
  it("tells him, because he is standing in a shop buying from what is on screen", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<BuyerOrderView />);
    await waitFor(() => expect(screen.queryByText(/Test/)).toBeTruthy());
    expect(screen.queryByText("buyer.listChanged")).toBeNull();

    // The operator repricing a line, or adding one, while he has it open.
    mocks.lines = [line(1, 4)];
    await vi.advanceTimersByTimeAsync(31_000);
    await waitFor(() => expect(screen.getByText("buyer.listChanged")).toBeTruthy());
  });

  it("does not replace the grid underneath him on its own", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<BuyerOrderView />);
    await waitFor(() => expect(screen.queryByText(/Test/)).toBeTruthy());

    mocks.lines = [line(1, 9)];
    await vi.advanceTimersByTimeAsync(31_000);
    await waitFor(() => expect(screen.getByText("buyer.listChanged")).toBeTruthy());
    // He may be mid-edit; replacing rows under a half-typed price loses his
    // work. The reload is his to press.
    expect(screen.getByText("buyer.reloadList")).toBeTruthy();
  });
});
