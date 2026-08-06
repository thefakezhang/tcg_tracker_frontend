// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CardIndexView from "./CardIndexView";

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("./use-query", () => ({
  useSupabaseQuery: (key: unknown) => {
    const query = Array.isArray(key) ? String(key[0]) : "";
    return query === "card-index-pokemon"
      ? {
          data: {
            cards: [{
              card_id: 1,
              card_uid: "12345678-1234-1234-1234-123456789abc",
              english_name_version: 1,
              regional_name: "ナンジャモ",
              english_name: "Iono",
              set_code: "SV2D",
              card_number: "091/071",
              language: "jp",
              misc_info: "SAR",
              image_url: null,
              links: [{ platform_name: "tcgplayer", external_reference_id: "509945" }],
            }],
            total: 1,
          },
          error: null,
          isLoading: false,
          retry: vi.fn(),
        }
      : {
          data: {
            products: [{
              product_id: 1,
              product_uid: "87654321-1234-1234-1234-123456789abc",
              name: "ポケモンカード151",
              english_name: "Pokemon Card 151",
              set_code: "SV2A",
              product_type: "booster_box",
              language: "jp",
              misc_info: "UNKNOWN",
              variant_edition: "standard",
              sealed_condition: "standard",
              image_url: null,
              links: [{ platform_name: "tcgplayer", external_reference_id: "493975" }],
            }],
            total: 1,
          },
          error: null,
          isLoading: false,
          retry: vi.fn(),
        };
  },
  QueryError: () => null,
}));
vi.mock("./CardIndexEditModal", () => ({ default: () => null }));
vi.mock("./CardIndexCreateModal", () => ({ default: () => null }));
vi.mock("./MtgCardIndex", () => ({ default: () => null }));
vi.mock("./PokemonMatchesTab", () => ({ default: () => null }));

afterEach(cleanup);

describe("Card Index responsive controls", () => {
  it("stacks the catalog selector and gives the Pokemon search a phone-sized target", () => {
    render(<CardIndexView />);

    expect(screen.getByTestId("catalog-index-header").className).toContain("flex-col");
    expect(screen.getByTestId("catalog-index-selector").className).toContain("grid-cols-1");
    for (const button of screen.getByTestId("catalog-index-selector").querySelectorAll("button")) {
      expect(button.className).toContain("w-full");
    }

    const sealedResults = screen.getByTestId("sealed-index-results");
    expect(sealedResults.className).toContain("overflow-hidden");
    expect(sealedResults.querySelector("thead")?.className).toContain("hidden");
    expect(sealedResults.querySelector("tbody")?.className).toContain("block");
    expect(sealedResults.querySelector("tbody tr")?.className).toContain("block");

    fireEvent.click(screen.getByRole("button", { name: "game.pokemon" }));

    const search = screen.getByPlaceholderText("cardIndex.search");
    expect(search.className).toContain("h-11");
    expect(search.parentElement?.className).toContain("w-full");
    expect(screen.getByRole("button", { name: "cardIndex.newCard" }).className).toContain("h-11");

    const pokemonResults = screen.getByTestId("pokemon-index-results");
    expect(pokemonResults.className).toContain("overflow-hidden");
    expect(pokemonResults.querySelector("thead")?.className).toContain("hidden");
    expect(pokemonResults.querySelector("tbody")?.className).toContain("block");
    expect(pokemonResults.querySelector("tbody tr")?.className).toContain("block");
    expect(screen.getByText("12345678")).toBeTruthy();
  });
});
