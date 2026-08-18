// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import MatchReviewView from "./MatchReviewView";

const mocks = vi.hoisted(() => ({
  queryKeys: [] as unknown[][],
  data: { candidates: [], items: new Map(), total: 0, proposedTotal: 0 } as {
    candidates: Record<string, unknown>[];
    items: Map<number, Record<string, unknown>>;
    total: number;
    proposedTotal?: number;
  },
  rpc: vi.fn(),
  retry: vi.fn(),
  pages: [] as unknown[][],
}));

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      let value = key;
      for (const [name, replacement] of Object.entries(params ?? {})) {
        value = value.replace(`{${name}}`, String(replacement));
      }
      return value;
    },
  }),
}));

// A chainable stand-in for the PostgREST builder: every filter returns the
// builder, and `range` resolves to the page mocks.pages hands out. Only what
// proposedIdsInFilter touches (select / eq / gte / or / not / order / range).
function fakeBuilder() {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "or", "not", "order", "in"]) b[m] = () => b;
  b.range = (from: number) => Promise.resolve({ data: mocks.pages.shift() ?? [], error: null, from });
  return b;
}
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc, from: () => fakeBuilder() }) }));

vi.mock("./use-query", () => ({
  useSupabaseQuery: (key: unknown[]) => {
    mocks.queryKeys.push(key);
    return {
      data: mocks.data,
      error: null,
      isLoading: false,
      retry: mocks.retry,
    };
  },
  QueryError: () => null,
}));

afterEach(() => {
  cleanup();
  mocks.queryKeys.length = 0;
  mocks.data = { candidates: [], items: new Map(), total: 0, proposedTotal: 0 };
  mocks.rpc.mockReset();
  mocks.retry.mockReset();
  mocks.pages.length = 0;
});

describe("accept all proposals", () => {
  function proposedRow(id: number) {
    return {
      candidate_id: id, source_platform: "identity", source_key: "", source_name: `card ${id}`, source_raw: null,
      source_fields: { source: "hareruya2", set_code: "SI", card_number: `${id}/414`, misc_info: "UNKNOWN", language: "jp" },
      source_image_url: null, proposed_id: 808600 + id, candidate_ids: [], confidence: 1, reason: "identity", matched: [],
    };
  }

  it("confirms every proposal in the filter in chunks and reports the real count", async () => {
    // 250 proposals in the filter, only one page of 2 rows loaded: accept-all
    // must act on the 250, not the 2, and must not send them in one call.
    mocks.data = { candidates: [proposedRow(1), proposedRow(2)], items: new Map(), total: 250, proposedTotal: 250 };
    mocks.pages = [Array.from({ length: 250 }, (_, i) => ({ candidate_id: i + 1 })), []];
    // The bulk RPC returns a bare integer: rows it actually confirmed.
    mocks.rpc.mockImplementation((_name: string, args: { p_ids: number[] }) => Promise.resolve({ data: args.p_ids.length - 1, error: null }));

    render(<MatchReviewView initialGame="pokemon" initialSource="hareruya2" />);
    fireEvent.click(screen.getByRole("button", { name: "review.acceptAll" }));
    fireEvent.click(await screen.findByRole("button", { name: "review.acceptAllConfirm" }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(3));
    const calls = mocks.rpc.mock.calls as [string, { p_ids: number[] }][];
    expect(calls.every(([name]) => name === "card_index_resolve_pokemon_candidates_confirm")).toBe(true);
    expect(calls.map(([, a]) => a.p_ids.length)).toEqual([100, 100, 50]);
    expect(calls.flatMap(([, a]) => a.p_ids)).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
    // 99 + 99 + 49 confirmed: the status carries what the RPCs said, not what was asked.
    await waitFor(() => expect(screen.getByText("review.acceptAllDone")).toBeTruthy());
    expect(mocks.retry).toHaveBeenCalledOnce();
  });

  it("stops at the first failing chunk and says how far it got", async () => {
    mocks.data = { candidates: [proposedRow(1)], items: new Map(), total: 150, proposedTotal: 150 };
    mocks.pages = [Array.from({ length: 150 }, (_, i) => ({ candidate_id: i + 1 })), []];
    mocks.rpc
      .mockResolvedValueOnce({ data: 100, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "identity X IS definition card 42" } });

    render(<MatchReviewView initialGame="pokemon" initialSource="hareruya2" />);
    fireEvent.click(screen.getByRole("button", { name: "review.acceptAll" }));
    fireEvent.click(await screen.findByRole("button", { name: "review.acceptAllConfirm" }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("review.acceptAllStopped")).toBeTruthy());
    expect(mocks.retry).toHaveBeenCalledOnce();
  });

  it("offers nothing to accept when no row carries a proposal", () => {
    mocks.data = { candidates: [], items: new Map(), total: 40, proposedTotal: 0 };
    render(<MatchReviewView initialGame="pokemon" initialSource="hareruya2" />);
    expect(screen.queryByRole("button", { name: "review.acceptAll" })).toBeNull();
  });
});

describe("Pokemon collision resolution", () => {
  it("moves only the exact displayed source link through the validated RPC", async () => {
    mocks.rpc.mockResolvedValue({ error: null });
    mocks.data = {
      candidates: [{
        candidate_id: 52608,
        source_platform: "identity",
        source_key: "",
        source_name: "Charizard V",
        source_raw: null,
        source_fields: {
          source: "expedition_gaming",
          set_code: "SC",
          card_number: "001/021",
          misc_info: "RR仕様, sC",
          language: "jp",
          collisions: JSON.stringify([{
            platform: "expedition_gaming",
            id: "SC|001/021",
            existing_card_id: 808579,
            existing_name: "リザードンV",
            existing_set_code: "SC2",
            existing_card_number: "001/021",
          }]),
        },
        source_image_url: null,
        proposed_id: 808590,
        candidate_ids: [],
        confidence: 1,
        reason: "expedition matcher (buyback)",
        matched: [],
      }],
      items: new Map([[808590, {
        id: 808590,
        uid: "00000000-0000-0000-0000-000000000001",
        name: "リザードンV",
        subtitle: "SEL · 001/021",
        links: [],
      }]]),
      total: 1,
    };

    render(<MatchReviewView initialGame="pokemon" initialSource="expedition_gaming" />);
    fireEvent.click(screen.getByRole("button", { name: "review.collisionMove" }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(
      "card_index_resolve_pokemon_candidate_move_link",
      {
        p_candidate_id: 52608,
        p_card_id: 808590,
        p_from_card_id: 808579,
        p_platform: "expedition_gaming",
        p_external_reference_id: "SC|001/021",
      },
    ));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.retry).toHaveBeenCalledOnce();
  });
});

describe("MatchReviewView initial source filter", () => {
  it("opens a deliberately broken Pokémon source in its filtered queue", () => {
    render(<MatchReviewView initialGame="pokemon" initialSource="big_tcg" />);

    const source = screen.getByRole("combobox", { name: "review.sourceFilter" }) as HTMLSelectElement;
    expect(source.value).toBe("big_tcg");
    expect(screen.getByRole("option", { name: "BIG TCG" })).toBeTruthy();
    expect(mocks.queryKeys.at(-1)).toEqual(["match-review", "pokemon", "generated", "big_tcg", "500"]);
  });

  it("keeps an unlisted source visible instead of silently falling back to all", () => {
    render(<MatchReviewView initialGame="pokemon" initialSource="broken_fixture_source" />);

    const source = screen.getByRole("combobox", { name: "review.sourceFilter" }) as HTMLSelectElement;
    expect(source.value).toBe("broken_fixture_source");
    expect(screen.getByRole("option", { name: "broken_fixture_source" })).toBeTruthy();
  });
});
