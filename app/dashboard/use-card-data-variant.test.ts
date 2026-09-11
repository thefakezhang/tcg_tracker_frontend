import { describe, expect, it, vi } from "vitest";
import {
  MTG_CARD_DEF_COLS,
  POKEMON_CARD_DEF_COLS,
  cardDefCols,
  cardSummarySelect,
  fetchCardRowById,
} from "./use-card-data";
import { buylistSummaryQuery } from "./BuyListView";

function queryBuilder(result: unknown) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.single.mockReturnValue(builder);
  return builder;
}

describe("Pokemon card-definition variant propagation", () => {
  it("carries typed fields through the shared Browser, detail-row, and Buy List summary projection", async () => {
    const definition = {
      card_id: "42",
      card_uid: "da807f6b-e540-44a1-bbbc-1b3179cf9211",
      regional_name: "カード",
      english_name: "Card",
      set_code: "SV-P",
      card_number: "124",
      misc_info: "SA,ミラー,1ED",
      edition: "first",
      foil_treatment: "mirror",
      variant_attrs: ["SA"],
      image_url: null,
    };
    const summary = queryBuilder({
      data: [{
        card_id: 42,
        tier: 1,
        psa_grade: 0,
        best_buy_price: null,
        best_sell_price: null,
        roi: null,
        pokemon_card_definitions: definition,
      }],
      error: null,
    });
    const from = vi.fn(() => summary);

    const row = await fetchCardRowById({ from } as never, "pokemon", 42, 0);

    expect(from).toHaveBeenCalledWith("pokemon_price_summaries_browser_v");
    expect(summary.select).toHaveBeenCalledWith(
      `*, pokemon_card_definitions!inner(${POKEMON_CARD_DEF_COLS})`,
    );
    expect(cardSummarySelect("pokemon", "pokemon_card_definitions"))
      .toBe(`*, pokemon_card_definitions!inner(${POKEMON_CARD_DEF_COLS})`);
    expect(cardDefCols("pokemon")).toContain("misc_info, edition, foil_treatment, variant_attrs");
    expect(row?.card).toEqual(expect.objectContaining({
      edition: "first",
      foil_treatment: "mirror",
      variant_attrs: ["SA"],
    }));
  });

  it("keeps the MTG summary projection byte-for-byte unchanged", () => {
    expect(cardDefCols("mtg")).toBe(MTG_CARD_DEF_COLS);
    expect(MTG_CARD_DEF_COLS).toBe(
      "card_id, card_uid, regional_name, set_code, card_number, misc_info, image_url, is_foil, foil_type, language",
    );
    expect(cardSummarySelect("mtg", "mtg_card_definitions_v"))
      .toBe(`*, mtg_card_definitions_v!inner(${MTG_CARD_DEF_COLS})`);
    expect(MTG_CARD_DEF_COLS).not.toMatch(/edition|foil_treatment|variant_attrs/);
  });

  it("uses the typed shared projection at the Buy List PostgREST boundary", () => {
    const builder = {
      select: vi.fn(),
      in: vi.fn(),
    };
    builder.select.mockReturnValue(builder);
    builder.in.mockReturnValue(builder);
    const from = vi.fn(() => builder);

    expect(buylistSummaryQuery(
      { from } as never,
      "pokemon",
      "pokemon_price_summaries",
      "pokemon_card_definitions",
      [42],
    )).toBe(builder);
    expect(from).toHaveBeenCalledWith("pokemon_price_summaries");
    expect(builder.select).toHaveBeenCalledWith(
      `*, pokemon_card_definitions!inner(${POKEMON_CARD_DEF_COLS})`,
    );
    expect(builder.in).toHaveBeenCalledWith("card_id", [42]);
  });
});
