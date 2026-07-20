// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import MatchReviewView from "./MatchReviewView";

const mocks = vi.hoisted(() => ({ queryKeys: [] as unknown[][] }));

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

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

vi.mock("./use-query", () => ({
  useSupabaseQuery: (key: unknown[]) => {
    mocks.queryKeys.push(key);
    return {
      data: { candidates: [], items: new Map(), total: 0 },
      error: null,
      isLoading: false,
      retry: vi.fn(),
    };
  },
  QueryError: () => null,
}));

afterEach(() => {
  cleanup();
  mocks.queryKeys.length = 0;
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
