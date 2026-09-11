// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PokemonVariantBadge } from "./PokemonCardIndex";

afterEach(cleanup);

describe("Pokemon Card Index typed variant badge", () => {
  it.each(["SA,ミラー,1ED", "SA"])(
    "renders the same label from compatibility misc %s",
    (miscInfo) => {
      render(<PokemonVariantBadge card={{
        misc_info: miscInfo,
        edition: "first",
        foil_treatment: "mirror",
        variant_attrs: ["SA"],
      }} />);

      expect(screen.getByText("SA,ミラー,1ED")).toBeTruthy();
    },
  );

  it("renders no badge for an explicitly axis-free base printing", () => {
    const { container } = render(<PokemonVariantBadge card={{
      misc_info: "UNKNOWN",
      edition: "not_applicable",
      foil_treatment: "normal",
      variant_attrs: [],
    }} />);

    expect(container.childElementCount).toBe(0);
  });
});
