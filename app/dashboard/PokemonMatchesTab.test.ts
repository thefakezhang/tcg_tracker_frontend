import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));

import { fetchMatches, fetchSources } from "./PokemonMatchesTab";
import { POKEMON_INDEX_MATCH_VIEW } from "./pokemon-index-visibility";

const queryMethods = ["select", "eq", "or", "order", "limit"] as const;

function queryBuilder(result: unknown) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of queryMethods) builder[method].mockReturnValue(builder);
  return builder;
}

describe("Pokemon Card Index match-memory visibility", () => {
  beforeEach(() => mocks.createClient.mockReset());

  it("uses the operator-safe match view for both the table and source chips", async () => {
    const matches = queryBuilder({ data: [], error: null });
    const sources = queryBuilder({ data: [], error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(matches)
      .mockReturnValueOnce(sources);
    mocks.createClient
      .mockReturnValueOnce({ from })
      .mockReturnValueOnce({ from });

    await fetchMatches("", "");
    await fetchSources();

    expect(from).toHaveBeenNthCalledWith(1, POKEMON_INDEX_MATCH_VIEW);
    expect(from).toHaveBeenNthCalledWith(2, POKEMON_INDEX_MATCH_VIEW);
  });
});
