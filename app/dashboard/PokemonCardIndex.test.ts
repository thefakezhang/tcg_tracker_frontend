import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  selectAll: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/select-all", () => ({ selectAll: mocks.selectAll }));

import {
  fetchIndex,
  pokemonEditActionClassName,
  pokemonEditActionLabel,
  pokemonEditRPCArgs,
} from "./PokemonCardIndex";

const queryMethods = ["select", "eq", "in", "or", "order", "limit", "maybeSingle"] as const;
type QueryMethod = (typeof queryMethods)[number];
type QueryBuilder = Record<QueryMethod, ReturnType<typeof vi.fn>> & {
  then: PromiseLike<unknown>["then"];
};

function queryBuilder(result: unknown) {
  const builder: QueryBuilder = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  for (const method of queryMethods) {
    builder[method].mockReturnValue(builder);
  }
  return builder;
}

describe("Pokemon Card Index query boundary", () => {
  beforeEach(() => {
    mocks.createClient.mockReset();
    mocks.selectAll.mockReset();
  });

  it("queries both Iono tokens, selects the CAS version, and returns the exact uid", async () => {
    const lookup = queryBuilder({ data: [], error: null });
    const count = queryBuilder({ count: 1, error: null });
    const definitions = queryBuilder({
      data: [{
        card_id: 42,
        card_uid: "da807f6b-e540-44a1-bbbc-1b3179cf9211",
        english_name_version: 1,
        regional_name: "ナンジャモ",
        english_name: "Iono",
        set_code: "SV-P",
        card_number: "124",
        language: "en",
        misc_info: "SR仕様, 英語版",
        image_url: null,
        is_cute: true,
      }],
      error: null,
    });
    const location = queryBuilder({ data: null, error: null });
    let definitionQueries = 0;
    mocks.createClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "pokemon_external_identifiers") return lookup;
        if (table === "pokemon_card_definitions") {
          definitionQueries += 1;
          return definitionQueries === 1 ? count : definitions;
        }
        if (table === "locations") return location;
        throw new Error(`unexpected table ${table}`);
      }),
    });
    mocks.selectAll.mockResolvedValue([{
      card_id: 42,
      platform_name: "tcgplayer",
      external_reference_id: "545661",
    }]);

    const result = await fetchIndex("Iono 124", 500, []);

    const expectedFilters = [
      "regional_name.ilike.%Iono%,english_name.ilike.%Iono%,set_code.ilike.%Iono%,card_number.ilike.%Iono%",
      "regional_name.ilike.%124%,english_name.ilike.%124%,set_code.ilike.%124%,card_number.ilike.%124%",
    ];
    expect(count.or.mock.calls.map(([filter]) => filter)).toEqual(expectedFilters);
    expect(definitions.or.mock.calls.map(([filter]) => filter)).toEqual(expectedFilters);
    expect(definitions.select).toHaveBeenCalledWith(expect.stringContaining("english_name_version"));
    // The curator flags ride along on every index row: the Card Index is the
    // surface that reaches cards the price-summary-driven browser never lists.
    expect(definitions.select).toHaveBeenCalledWith(expect.stringContaining("is_cute, japan_exclusive_artwork"));
    expect(definitions.select).not.toHaveBeenCalledWith(expect.stringContaining("is_japan_exclusive"));
    expect(result.total).toBe(1);
    expect(result.cards).toEqual([
      expect.objectContaining({
        card_uid: "da807f6b-e540-44a1-bbbc-1b3179cf9211",
        english_name: "Iono",
        english_name_version: 1,
        is_cute: true,
        links: [expect.objectContaining({ external_reference_id: "545661" })],
      }),
    ]);
  });

  it("sends the current English-name version on every edit RPC payload", () => {
    const form = {
      regional_name: "ナンジャモ",
      english_name: "Iono",
      set_code: "SV-P",
      card_number: "124",
      language: "en",
      misc_info: "SR仕様, 英語版",
      image_url: "",
    };

    expect(pokemonEditRPCArgs(42, 7, form, "")).toMatchObject({
      p_card_id: 42,
      p_expected_version: 7,
      p_english_name: "Iono",
    });
    expect(pokemonEditRPCArgs(42, 8, form, "https://example.test/iono.jpg")).toMatchObject({
      p_card_id: 42,
      p_expected_version: 8,
      p_image_url: "https://example.test/iono.jpg",
    });
  });

  it("gives the edit action an explicit card-specific accessible name", () => {
    expect(pokemonEditActionLabel({ regional_name: "ナンジャモ", card_number: "124" }, "Edit"))
      .toBe("Edit ナンジャモ 124");
    expect(pokemonEditActionClassName).toContain("size-11");
    expect(pokemonEditActionClassName).toContain("sm:size-7");
  });
});
