// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
    language: "en",
  }),
}));

const ROWS: Record<string, Record<string, unknown>[]> = {
  mtg_format_archetypes_v: [
    { format_code: "MO", format_name: "Modern", archetype_id: 351, archetype_name: "UR Aggro", macro_class: "AGGRO", rank: 1, share_2m: 7, share_2w: 6, share_2m_prior: 7.5, trend: null, decks_2m: 3477, decks_2w: 588, observed_at: "2026-11-22T10:00:00Z", prior_observed_at: "2026-11-15T10:00:00Z", evidence_url: "https://www.mtgtop8.com/archetype?a=351&meta=51&f=MO" },
    { format_code: "MO", format_name: "Modern", archetype_id: 918, archetype_name: "Rakdos Aggro", macro_class: "COMBO", rank: 9, share_2m: 8, share_2w: 10, share_2m_prior: 6, trend: "up_light", decks_2m: 3477, decks_2w: 588, observed_at: "2026-11-22T10:00:00Z", prior_observed_at: "2026-11-15T10:00:00Z", evidence_url: "https://www.mtgtop8.com/archetype?a=918&meta=51&f=MO" },
  ],
  mtg_format_card_play_v: [
    { format_code: "MO", format_name: "Modern", board: "MD", card_name: "Arid Mesa", catalog_key: "ARID MESA", rank_2m: 1, share_2m: 33.3, decks_2m: 1153, avg_2m: 2.8, rank_2w: 1, share_2w: 35.1, avg_2w: 2.8, share_2m_prior: 31, total_decks_2m: 3477, observed_at: "2026-11-22T10:00:00Z", in_catalog: true, median_sell_usd: 31.5, priced_printings: 12, evidence_url: "https://www.mtgtop8.com/topcards?f=MO&meta=51" },
    { format_code: "MO", format_name: "Modern", board: "MD", card_name: "Brand New Card", catalog_key: "BRAND NEW CARD", rank_2m: null, share_2m: null, decks_2m: null, avg_2m: null, rank_2w: 40, share_2w: 4.2, avg_2w: 4, share_2m_prior: null, total_decks_2m: 3477, observed_at: "2026-11-22T10:00:00Z", in_catalog: false, median_sell_usd: null, priced_printings: null, evidence_url: "https://www.mtgtop8.com/topcards?f=MO&meta=51" },
    { format_code: "MO", format_name: "Modern", board: "SB", card_name: "Flusterstorm", catalog_key: "FLUSTERSTORM", rank_2m: 3, share_2m: 9, decks_2m: 313, avg_2m: 1.5, rank_2w: 3, share_2w: 9, avg_2w: 1.5, share_2m_prior: 9, total_decks_2m: 3477, observed_at: "2026-11-22T10:00:00Z", in_catalog: true, median_sell_usd: 18, priced_printings: 4, evidence_url: "https://www.mtgtop8.com/topcards?f=MO&meta=51" },
  ],
};

const calls: { table: string; eq: [string, unknown] | null }[] = [];
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (col: string, value: unknown) => {
          calls.push({ table, eq: [col, value] });
          return { __rows: (ROWS[table] ?? []).filter((r) => r[col] === value) };
        },
      }),
    }),
  }),
}));
vi.mock("@/lib/supabase/select-all", () => ({
  selectAll: vi.fn(async (build: () => { __rows: unknown[] }) => build().__rows),
}));

import MtgMetaView from "./MtgMetaView";

afterEach(cleanup);

describe("MtgMetaView", () => {
  // Ranked by share, not by the stored rank, which is the page's
  // class-grouped position: Rakdos (8%, rank 9) comes before UR (7%, rank 1).
  it("reads one format, ranks the archetypes by share and shows each card's direction", async () => {
    render(<MtgMetaView />);
    const archetypes = await screen.findByTestId("mtg-meta-archetype-table");
    const names = within(archetypes).getAllByRole("link").map((a) => a.textContent);
    expect(names).toEqual(["Rakdos Aggro", "UR Aggro"]);
    // +2.0 since last week for Rakdos, -0.5 for UR.
    expect(archetypes.textContent).toContain("+2.0");
    expect(archetypes.textContent).toContain("-0.5");
    expect(calls.every((c) => c.eq?.[0] === "format_code" && c.eq?.[1] === "MO")).toBe(true);

    const rows = screen.getAllByTestId("mtg-meta-card-row");
    expect(rows.map((r) => r.querySelector("td span")?.textContent)).toEqual(["Arid Mesa", "Brand New Card"]);
    expect(rows[0].textContent).toContain("33.3%");
    expect(rows[0].textContent).toContain("$31.50");
    // A card in the last two weeks and under the floor over two months is new.
    expect(within(rows[1]).getByRole("img", { name: "mtgMeta.new" })).toBeTruthy();
    expect(rows[1].textContent).toContain("mtgMeta.notInCatalog");
  });

  it("switches to the sideboard and filters to rising cards", async () => {
    render(<MtgMetaView />);
    await screen.findByTestId("mtg-meta-card-table");
    fireEvent.click(screen.getByRole("button", { name: "mtgMeta.risingOnly" }));
    expect(screen.getAllByTestId("mtg-meta-card-row").map((r) => r.textContent?.startsWith("Brand New Card"))).toEqual([true]);
  });
});
