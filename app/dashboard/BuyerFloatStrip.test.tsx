// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from }),
}));

import BuyerFloatStrip from "./BuyerFloatStrip";

afterEach(cleanup);

// Shaped like the views he actually reads. They carry no USD column, so a test
// that fed one in would be testing a database that does not exist.
const balance = {
  remitted_jpy: 150000, spent_jpy: 90000, fees_jpy: 2900,
  refunded_jpy: 50000, settled_jpy: 0, balance_jpy: 107100,
};

const movements = [
  { entry_id: 2, kind: "refund", amount_jpy: 50000, occurred_at: "2026-09-02", note: "cardrush cancelled" },
  { entry_id: 1, kind: "remittance", amount_jpy: 150000, occurred_at: "2026-09-01", note: null },
];

beforeEach(() => {
  from.mockReset();
  from.mockImplementation((table: string) => {
    if (table === "buyer_float_self_v") {
      return { select: () => ({ maybeSingle: () => Promise.resolve({ data: balance, error: null }) }) };
    }
    return { select: () => ({ limit: () => Promise.resolve({ data: movements, error: null }) }) };
  });
});

describe("BuyerFloatStrip", () => {
  it("leads with what he is holding, because that is the number he acts on", async () => {
    render(<BuyerFloatStrip />);
    expect(await screen.findByText("¥107,100")).toBeTruthy();
  });

  it("reads only the JPY-only views", async () => {
    render(<BuyerFloatStrip />);
    await screen.findByText("¥107,100");
    for (const [table] of from.mock.calls) {
      expect(table.endsWith("_self_v") || table.endsWith("_self_entries_v")).toBe(true);
    }
  });

  it("shows no dollar figure anywhere", async () => {
    const { container } = render(<BuyerFloatStrip />);
    await screen.findByText("¥107,100");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(container.textContent).not.toMatch(/\$|USD|rate/i);
  });

  it("counts handling fees as money that has left him", async () => {
    render(<BuyerFloatStrip />);
    // 90,000 spent + 2,900 in fees. Splitting them would invite the reading
    // that the fees are still his to spend.
    expect(await screen.findByText("¥92,900")).toBeTruthy();
  });

  it("stays out of the way of an agent who has never been sent money", async () => {
    from.mockImplementation((table: string) => {
      const empty = { remitted_jpy: 0, spent_jpy: 0, fees_jpy: 0, refunded_jpy: 0, settled_jpy: 0, balance_jpy: 0 };
      if (table === "buyer_float_self_v") {
        return { select: () => ({ maybeSingle: () => Promise.resolve({ data: empty, error: null }) }) };
      }
      return { select: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) };
    });
    const { container } = render(<BuyerFloatStrip />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe("");
  });
});
