// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "./LanguageContext";
import AopReviewTab, { type ReviewRow } from "./AopReviewTab";

const rows = vi.hoisted(() => [
  {
    candidate_id: 1,
    source_name: "_____のピカチュウ",
    english_name: "_____'s Pikachu",
    illustrator: "Ken Sugimori",
    set_code: "OLD-UPC",
    card_number: null,
    misc_info: "UNKNOWN",
    language: "jp",
    source_image_url: "https://cdn.test/aop-pikachu.webp",
    source_fields: null,
    // the case the tab exists for: no printed number, so no complete identity
    ready: false,
  },
  {
    candidate_id: 2,
    source_name: "ポケモンイラストレーター",
    english_name: "Pokémon Illustrator",
    illustrator: "Atsuko Nishida",
    set_code: "OLD-UPC",
    card_number: "007/019",
    misc_info: "UNKNOWN",
    language: "jp",
    source_image_url: "https://cdn.test/aop-illustrator.webp",
    source_fields: null,
    ready: true,
  },
]);

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("./use-query", () => ({
  useSupabaseQuery: () => ({ data: rows as unknown as ReviewRow[], error: null, isLoading: false, retry: vi.fn() }),
  QueryError: () => null,
}));
vi.mock("@/lib/use-saving", () => ({ useSaving: () => ({ saving: false, save: vi.fn() }) }));

afterEach(cleanup);

describe("AopReviewTab", () => {
  it("shows each candidate with its scan, and says which cannot be created", () => {
    render(
      <LanguageProvider>
        <AopReviewTab />
      </LanguageProvider>,
    );

    // Both candidates listed, by their Japanese name.
    expect(screen.getByText("_____のピカチュウ")).toBeTruthy();
    expect(screen.getByText("ポケモンイラストレーター")).toBeTruthy();

    expect(screen.getByAltText("_____のピカチュウ").getAttribute("src")).toBe("https://cdn.test/aop-pikachu.webp");

    // The row that cannot be created says why, once. The row that can says
    // nothing: it needs no explanation, and in the normal course it should
    // never have reached this screen at all.
    expect(screen.getAllByText(/Cannot be created as-is/)).toHaveLength(1);

    // Both actions are offered per row, and neither is disabled while idle -
    // a greyed button on a dimmed row was previously mistaken for a dead click.
    const creates = screen.getAllByRole("button", { name: "Create" });
    expect(creates).toHaveLength(2);
    expect(creates.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getAllByRole("button", { name: "Not needed" })).toHaveLength(2);
  });

  it("counts what can be created against what cannot", () => {
    render(
      <LanguageProvider>
        <AopReviewTab />
      </LanguageProvider>,
    );
    expect(screen.getByRole("button", { name: "All (2)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ready to create (1)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Needs an identity (1)" })).toBeTruthy();
  });

  it("never counts name collisions, which decide nothing", () => {
    render(
      <LanguageProvider>
        <AopReviewTab />
      </LanguageProvider>,
    );
    // Identity is (set_code, card_number, misc_info, language). Two cards
    // sharing a name is the normal case; surfacing it asked the operator to
    // adjudicate noise, and it is why a row with nothing to decide was shown.
    expect(screen.queryByText(/shares a name/i)).toBeNull();
    expect(screen.queryByText(/clash/i)).toBeNull();
  });
});
