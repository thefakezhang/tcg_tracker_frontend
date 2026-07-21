// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import MatchReviewView from "./MatchReviewView";

const mocks = vi.hoisted(() => ({
  queryKeys: [] as unknown[][],
  data: { candidates: [], items: new Map(), total: 0 } as {
    candidates: Record<string, unknown>[];
    items: Map<number, Record<string, unknown>>;
    total: number;
  },
  rpc: vi.fn(),
  retry: vi.fn(),
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

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));

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
  mocks.data = { candidates: [], items: new Map(), total: 0 };
  mocks.rpc.mockReset();
  mocks.retry.mockReset();
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
