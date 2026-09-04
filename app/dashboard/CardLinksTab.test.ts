import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));

import { fetchCards, fetchSetsNeedingLinks } from "./CardLinksTab";
import { POKEMON_INDEX_LINK_COVERAGE_VIEW } from "./pokemon-index-visibility";

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

describe("Pokemon Card Index Needs IDs visibility", () => {
  beforeEach(() => mocks.createClient.mockReset());

  it("uses the operator-safe coverage view for both set counts and card rows", async () => {
    const sets = queryBuilder({ data: [], error: null });
    const cards = queryBuilder({ data: [], error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(sets)
      .mockReturnValueOnce(cards);
    mocks.createClient
      .mockReturnValueOnce({ from })
      .mockReturnValueOnce({ from });

    await fetchSetsNeedingLinks("tcgplayer");
    await fetchCards("SV-P", "tcgplayer", "");

    expect(from).toHaveBeenNthCalledWith(1, POKEMON_INDEX_LINK_COVERAGE_VIEW);
    expect(from).toHaveBeenNthCalledWith(2, POKEMON_INDEX_LINK_COVERAGE_VIEW);
  });
});
