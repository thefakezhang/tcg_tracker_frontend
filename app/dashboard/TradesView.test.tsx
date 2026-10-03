// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "./LanguageContext";

const mocks = vi.hoisted(() => ({
  mainError: null as Error | null,
  optionsError: null as Error | null,
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));

vi.mock("./use-query", () => ({
  QueryError: ({ error }: { error: Error }) => <div role="alert">{error.message}</div>,
  useSupabaseQuery: (key: string | null) => {
    if (key == null) {
      return { data: undefined, error: undefined, isLoading: false, retry: vi.fn() };
    }
    const isOptions = key === "trades:options";
    const error = isOptions ? mocks.optionsError : mocks.mainError;
    return {
      data: isOptions ? { sales: [], lots: [] } : [],
      error: error ?? undefined,
      isLoading: false,
      retry: vi.fn(),
    };
  },
}));

import TradesView, { fetchTrades } from "./TradesView";

afterEach(cleanup);

beforeEach(() => {
  mocks.mainError = null;
  mocks.optionsError = null;
  mocks.rpc.mockReset().mockResolvedValue({ error: null });
});

function row(id: number) {
  return {
    trade_id: id,
    traded_at: "2026-10-01",
    counterparty: `Counterparty ${id}`,
    cash_usd: 0,
    sale_group: id,
    value_out_usd: 10,
    lot_id: id,
    value_in_usd: 10,
    balanced: true,
    imbalance_usd: 0,
    notes: null,
  };
}

function pagedClient(rows: ReturnType<typeof row>[]) {
  const ranges: Array<[number, number]> = [];
  return {
    ranges,
    client: {
      from: vi.fn(() => ({
        select: vi.fn(() => {
          const builder = {
            order: vi.fn(() => builder),
            range: vi.fn(async (from: number, to: number) => {
              ranges.push([from, to]);
              return { data: rows.slice(from, to + 1), error: null };
            }),
          };
          return builder;
        }),
      })),
    },
  };
}

describe("TradesView data contracts", () => {
  it("pages beyond the old 200-row cap with a total order", async () => {
    const rows = Array.from({ length: 1205 }, (_, index) => row(index + 1));
    const { client, ranges } = pagedClient(rows);

    const result = await fetchTrades(client as never);

    expect(result).toHaveLength(1205);
    expect(result[0].trade_id).toBe(1205);
    expect(result.at(-1)?.trade_id).toBe(1);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [1205, 2204]]);
  });

  it("surfaces a trade-list read failure", () => {
    mocks.mainError = new Error("trade list unavailable");
    render(<LanguageProvider><TradesView /></LanguageProvider>);

    expect(screen.getByRole("alert").textContent).toContain("trade list unavailable");
  });

  it("surfaces option-query failures inside the record dialog", () => {
    mocks.optionsError = new Error("trade options unavailable");
    render(<LanguageProvider><TradesView /></LanguageProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Record trade" }));

    expect(screen.getByRole("alert").textContent).toContain("trade options unavailable");
  });
});
