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
    // the case the tab exists for: a promo already spun off into its own set
    lookalikes: [
      {
        card_id: 11,
        regional_name: "_____のピカチュウ",
        english_name: "_____'s Pikachu",
        set_code: "OLD-HIBPC",
        card_number: "旧裏",
        misc_info: "UNKNOWN",
        image_url: "https://cdn.test/ours.webp",
      },
    ],
  },
  {
    candidate_id: 2,
    source_name: "ポケモンイラストレーター",
    english_name: "Pokémon Illustrator",
    illustrator: "Atsuko Nishida",
    set_code: "OLD-UPC",
    card_number: null,
    misc_info: "UNKNOWN",
    language: "jp",
    source_image_url: "https://cdn.test/aop-illustrator.webp",
    source_fields: null,
    lookalikes: [],
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
  it("shows each candidate with its scan and the catalog cards sharing its name", () => {
    render(
      <LanguageProvider>
        <AopReviewTab />
      </LanguageProvider>,
    );

    // Both candidates listed, by their Japanese name.
    expect(screen.getByText("_____のピカチュウ")).toBeTruthy();
    expect(screen.getByText("ポケモンイラストレーター")).toBeTruthy();

    // The colliding row surfaces the card it may duplicate, so the operator can
    // compare pictures rather than guess from the name.
    expect(screen.getByAltText("_____のピカチュウ").getAttribute("src")).toBe("https://cdn.test/aop-pikachu.webp");
    // The catalog card's alt names its set, so the two images are distinguishable
    // to a screen reader even though both are the same card name.
    expect(screen.getByAltText("_____のピカチュウ (OLD-HIBPC)").getAttribute("src")).toBe("https://cdn.test/ours.webp");
    expect(screen.getByText(/OLD-HIBPC/)).toBeTruthy();

    // A row with nothing sharing its name says so, so it can be cleared fast.
    expect(screen.getByText(/No catalog card shares this name/)).toBeTruthy();

    // Both actions are offered per row, and neither is disabled while idle -
    // a greyed button on a dimmed row was previously mistaken for a dead click.
    const creates = screen.getAllByRole("button", { name: "Create" });
    expect(creates).toHaveLength(2);
    expect(creates.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getAllByRole("button", { name: "Not needed" })).toHaveLength(2);
  });

  it("counts the clash and no-clash buckets in the filters", () => {
    render(
      <LanguageProvider>
        <AopReviewTab />
      </LanguageProvider>,
    );
    expect(screen.getByRole("button", { name: "All (2)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Shares a name (1)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "No clash (1)" })).toBeTruthy();
  });
});
