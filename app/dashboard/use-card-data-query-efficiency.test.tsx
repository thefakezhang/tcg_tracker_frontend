// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ lookup: vi.fn(), rpc: vi.fn(), laneCalls: [] as string[], summaryReads: 0, rows: [] as Record<string, unknown>[], signals: [] as Record<string, unknown>[], signalBuckets: [] as number[] }));
vi.mock("@/lib/card-search", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/card-search")>(),
  externalIdMatches: mock.lookup,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      let offset = 0;
      const query = new Proxy({}, { get: (_target, method) => method === "then"
        ? (resolve: (value: unknown) => unknown) => {
          if (table.includes("summaries")) mock.summaryReads++;
          const data = table.includes("summaries") ? mock.rows
            : table === "pokemon_grade_signals" ? mock.signals.slice(offset, offset + 1000)
            : table === "exit_cost_profiles" || table === "exchange_rates" ? null : [];
          return Promise.resolve(resolve({ data, count: mock.rows.length, error: null }));
        }
        : method === "range" ? (from: number) => { offset = from; return query; }
        : () => query });
      return query;
    },
    rpc: (name: string, args: unknown, opts?: unknown) => {
      if (opts === undefined) mock.rpc(name, args);
      else mock.rpc(name, args, opts);
      if (name === "pokemon_price_lanes_browser") {
        // The lane function feeds the same filter chain as a table read.
        const query: object = new Proxy({}, { get: (_target, method) => method === "then"
          ? (resolve: (value: unknown) => unknown) =>
            Promise.resolve(resolve({ data: mock.rows, count: mock.rows.length, error: null }))
          : (...callArgs: unknown[]) => { mock.laneCalls.push(`${String(method)}:${JSON.stringify(callArgs)}`); return query; } });
        return query;
      }
      return { abortSignal: async () => ({ data: [], error: null }) };
    },
  }),
}));
vi.mock("./grade-signals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./grade-signals")>();
  return { ...actual, signalForRow: (...args: Parameters<typeof actual.signalForRow>) => {
    mock.signalBuckets.push(args[1].length);
    return actual.signalForRow(...args);
  } };
});
import { useCardData } from "./use-card-data";
const options: Parameters<typeof useCardData>[0] = {
  activeGame: "mtg", psaMode: "non-psa", search: "12345", searchCardNumber: "", searchSetCode: "",
  selectedTier: 1, sellRegion: "all", requiredSource: "", sourceSide: "sell", laneSources: null, rarity: null,
  promosOnly: false, soldEvidenceOnly: false, measuredExitsOnly: false, japanExclusivity: new Set(), mtgTags: new Set(),
  cuteOnly: false, minBuyPrice: null, minSellPrice: null, roiFloor: null, roiCeiling: null,
  sortColumn: "roi", sortAsc: false, exitPercentile: 25, page: 0, pageSize: 50,
};
afterEach(cleanup);
beforeEach(() => { mock.lookup.mockReset().mockResolvedValue([7, 11]); mock.rpc.mockClear(); mock.laneCalls = []; mock.summaryReads = 0; mock.rows = []; mock.signals = []; mock.signalBuckets = []; });

describe("card browser search work", () => {
  it("resolves an MTG identifier once and sends those exact IDs to the search RPC", async () => {
    const { result } = renderHook(() => useCardData(options));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mock.lookup).toHaveBeenCalledTimes(1);
    expect(mock.rpc).toHaveBeenCalledWith("search_mtg_price_summaries", expect.objectContaining({ p_card_ids: [7, 11], p_tokens: [], p_limit: 50 }));
    expect(mock.summaryReads).toBe(0);
  });
  it("keeps token search when there is no identifier match", async () => {
    mock.lookup.mockResolvedValue([]);
    const { result } = renderHook(() => useCardData({ ...options, search: "black lotus" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mock.rpc).toHaveBeenCalledWith("search_mtg_price_summaries", expect.objectContaining({ p_card_ids: [], p_tokens: ["black", "lotus"] }));
    expect(mock.lookup).toHaveBeenCalledTimes(1);
  });
  it("fails closed on identifier lookup errors", async () => {
    mock.lookup.mockRejectedValue(new Error("lookup failed"));
    const { result } = renderHook(() => useCardData(options));
    await waitFor(() => expect(result.current.error?.message).toBe("lookup failed"));
    expect(result.current.loading).toBe(false);
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.summaryReads).toBe(0);
  });
  it("discards a superseded identifier lookup before starting its RPC", async () => {
    let release!: (ids: number[]) => void;
    mock.lookup.mockImplementationOnce(() => new Promise<number[]>((resolve) => { release = resolve; }));
    const { result, rerender } = renderHook(({ page }) => useCardData({ ...options, page }), { initialProps: { page: 0 } });
    rerender({ page: 1 });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { release([99]); });
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.rpc).toHaveBeenCalledWith("search_mtg_price_summaries", expect.objectContaining({ p_card_ids: [7, 11], p_offset: 50 }));
  });
  it("matches Pokemon grades within each card's signals on a 50-card page", async () => {
    mock.rows = Array.from({ length: 50 }, (_, i) => ({
      card_id: i + 1, psa_grade: 10, tier: -1,
      pokemon_card_definitions: { card_id: String(i + 1), regional_name: `Card ${i + 1}` },
    }));
    mock.signals = mock.rows.flatMap((row) => Array.from({ length: 11 }, (_, grade) => ({
      card_id: row.card_id, psa_grade: grade, model_version: "v1", computed_at: "2026-11-19", band_p25: 100 + Number(row.card_id),
    })));
    const { result } = renderHook(() => useCardData({ ...options, activeGame: "pokemon", search: "", psaMode: "psa" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(50);
    expect(result.current.data.map((row) => [row.signal?.cardId, row.signal?.psaGrade, row.signal?.bandP25]))
      .toEqual(mock.rows.map((row) => [row.card_id, 10, 100 + Number(row.card_id)]));
    expect(mock.signalBuckets).toEqual(Array(50).fill(11));
  });
  it("asks the lane function for a source-restricted Pokemon lane, without the by-source filter", async () => {
    const laneSources = { entry: ["surugaya"], exit: ["tcgplayer", "cardrush"] };
    const { result } = renderHook(() => useCardData({
      ...options, activeGame: "pokemon", search: "", requiredSource: "surugaya", sourceSide: "sell", laneSources,
    }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mock.rpc).toHaveBeenCalledWith(
      "pokemon_price_lanes_browser",
      { p_tier: 1, p_psa: false, p_entry_sources: ["surugaya"], p_exit_sources: ["tcgplayer", "cardrush"] },
      { count: "exact" },
    );
    expect(mock.summaryReads).toBe(0);
    expect(mock.laneCalls.filter((call) => call.startsWith('eq:["source"'))).toEqual([]);
    expect(mock.laneCalls).toContain('eq:["tier",1]');
  });
  it("asks the lane function for graded copies at no tier", async () => {
    const { result } = renderHook(() => useCardData({
      ...options, activeGame: "pokemon", search: "", psaMode: "psa", laneSources: { entry: null, exit: ["cardladder"] },
    }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mock.rpc).toHaveBeenCalledWith(
      "pokemon_price_lanes_browser",
      { p_tier: null, p_psa: true, p_entry_sources: null, p_exit_sources: ["cardladder"] },
      { count: "exact" },
    );
  });
  it("retains the by-source embed fallback and uses one lookup", async () => {
    const { result } = renderHook(() => useCardData({ ...options, requiredSource: "cardrush" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mock.lookup).toHaveBeenCalledTimes(1);
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.summaryReads).toBe(1);
  });
});
