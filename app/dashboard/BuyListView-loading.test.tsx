// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const mock = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  reads: [] as { table: string; ids?: unknown[]; single: boolean; signal?: AbortSignal }[],
  cap: 1000,
  errorTable: "",
  errorList: null as number | null,
  holdList: null as number | null,
  release: null as (() => void) | null,
  visible: [] as Record<string, unknown>[],
  header: vi.fn(),
  remove: vi.fn(),
  modalRemove: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./LanguageContext", () => ({ useLanguage: () => ({ language: "en" }) }));
vi.mock("./GameContext", () => ({ useGame: () => ({ setActiveGame: vi.fn() }) }));
vi.mock("./HeaderContext", () => ({ useHeader: () => ({ setHeaderActions: mock.header }) }));
vi.mock("./BuyListContext", () => ({ useBuyList: () => ({ buylists: [{ buylist_id: 1, name: "Test" }], removeFromBuylist: mock.remove }) }));
vi.mock("./columns", () => ({ createBuylistColumns: () => [], PriceCell: () => null, TargetPriceCell: () => null }));
vi.mock("./CardDetailModal", () => ({ default: ({ onRemoveFromBuylist }: { onRemoveFromBuylist?: () => Promise<void> }) => {
  mock.modalRemove = onRemoveFromBuylist;
  return null;
} }));
vi.mock("./SealedDetailModal", () => ({ default: ({ onRemoveFromBuylist }: { onRemoveFromBuylist?: () => Promise<void> }) => {
  mock.modalRemove = onRemoveFromBuylist;
  return null;
} }));
vi.mock("./ExportBuyListModal", () => ({ default: () => null }));
vi.mock("./data-table", () => ({ DataTable: ({ data, loading, onRowClick }: { data: Row[]; loading: boolean; onRowClick: (row: Row) => void }) => {
  mock.visible = data;
  return <><div data-testid="entries">{loading ? "loading" : `${data.length} entries`}</div>{data[0] && <button onClick={() => onRowClick(data[0])}>open first</button>}</>;
} }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: (table: string) => {
  const filters: ((row: Row) => boolean)[] = [];
  const orders: string[] = [];
  let from = 0, to = Infinity, ids: unknown[] | undefined;
  let buylistId: number | null = null;
  let signal: AbortSignal | undefined;
  const execute = (single: boolean) => {
    mock.reads.push({ table, ids, single, signal });
    if (table === mock.errorTable && (mock.errorList == null || mock.errorList === buylistId)) return { data: null, error: { message: "catalog unavailable" } };
    const rows = (mock.tables[table] ?? []).filter((row) => filters.every((filter) => filter(row))).sort((a, b) => {
      for (const col of orders) {
        if (a[col] === b[col]) continue;
        const av = a[col], bv = b[col];
        return typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      }
      return 0;
    });
    return { data: single ? rows[0] ?? null : rows.slice(from, Math.min(to + 1, from + mock.cap)), error: null };
  };
  const query = {
    select: () => query,
    abortSignal: (value: AbortSignal) => { signal = value; return query; },
    eq: (col: string, value: unknown) => { if (col === "buylist_id") buylistId = Number(value); filters.push((row) => String(row[col]) === String(value)); return query; },
    in: (col: string, values: unknown[]) => { ids = values; filters.push((row) => values.some((value) => String(row[col]) === String(value))); return query; },
    order: (col: string) => { orders.push(col); return query; },
    range: (start: number, end: number) => { from = start; to = end; return query; },
    single: async () => execute(true),
    then: async (resolve: (value: unknown) => unknown) => {
      const result = execute(false);
      if (table === "pokemon_buylist_entries" && buylistId === mock.holdList) {
        await new Promise<void>((done) => { mock.release = () => { mock.holdList = null; done(); }; });
      }
      return resolve(result);
    },
  };
  return query;
} }) }));

import BuyListView from "./BuyListView";

function entry(id: number, cardId = id, grade = 0): Row {
  return { buylist_id: 1, entry_id: id, card_id: cardId, psa_grade: grade, target_price_usd: id + 0.5 };
}
function definition(id: number): Row { return { card_id: id, regional_name: `Card ${id}`, set_code: "S", image_url: null }; }
function sealedEntry(id: number, productId = id, condition = "shrink", edition = "unlimited"): Row {
  return { buylist_id: 1, entry_id: id, product_id: productId, sealed_condition: condition, variant_edition: edition, target_price_usd: id + 0.5 };
}
function catalogReads() { return mock.reads.filter(({ table }) => ["pokemon_card_definitions", "mtg_card_definitions_v", "pokemon_sealed_products"].includes(table)); }
async function mount(count: number) { render(<BuyListView buylistId={1} />); await screen.findByText(`${count} entries`); }
afterEach(cleanup);
beforeEach(() => { mock.tables = {}; mock.reads = []; mock.visible = []; mock.cap = 1000; mock.errorTable = ""; mock.errorList = null; mock.holdList = null; mock.release = null; mock.remove.mockReset().mockResolvedValue(undefined); mock.modalRemove = undefined; });

describe("buy-list catalog loading", () => {
  it("batches missing summaries for both singles games and sealed products", async () => {
    for (const game of ["pokemon", "mtg"]) {
      mock.tables[`${game}_buylist_entries`] = Array.from({ length: 50 }, (_, i) => entry(i + 1));
      mock.tables[game === "pokemon" ? "pokemon_card_definitions" : "mtg_card_definitions_v"] = Array.from({ length: 50 }, (_, i) => definition(i + 1));
    }
    mock.tables.pokemon_sealed_buylist_entries = Array.from({ length: 50 }, (_, i) => sealedEntry(i + 1));
    mock.tables.pokemon_sealed_products = Array.from({ length: 50 }, (_, i) => ({ product_id: i + 1, name: `Box ${i + 1}`, language: "ja", product_type: "booster_box" }));
    await mount(150);
    expect(catalogReads()).toHaveLength(6); // One data page plus the cap-safe empty page per catalog.
    expect(catalogReads().every((read) => !read.single)).toBe(true);
    expect(mock.visible.map((row) => row.key)).toEqual(["pokemon", "mtg", "pokemon_sealed"].flatMap((game) => Array.from({ length: 50 }, (_, i) => `${game}:${i + 1}`)));
    expect(mock.visible.every((row) => row.roi === null)).toBe(true);
  });

  it("pages through a lowered database cap and chunks/deduplicates fallback IDs", async () => {
    mock.cap = 73;
    mock.tables.pokemon_buylist_entries = [...Array.from({ length: 501 }, (_, i) => entry(i + 1)), entry(502, 1, 10)];
    mock.tables.pokemon_card_definitions = Array.from({ length: 501 }, (_, i) => definition(i + 1));
    await mount(502);
    expect(mock.visible[501]).toMatchObject({ key: "pokemon:502", psaGrade: 10, card: { regional_name: "Card 1" }, targetPriceUsd: 502.5 });
    expect(catalogReads()).toHaveLength(10);
    expect(Math.max(...catalogReads().map((read) => read.ids?.length ?? Infinity))).toBeLessThanOrEqual(500);
    expect(new Set(catalogReads().flatMap((read) => read.ids ?? [])).size).toBe(501);
  });

  it.each(["pokemon", "mtg"])("%s prefers raw tier 1, otherwise first raw tier, and keeps PSA matches exact", async (game) => {
    const definitionsTable = game === "pokemon" ? "pokemon_card_definitions" : "mtg_card_definitions_v";
    mock.tables[`${game}_buylist_entries`] = [entry(1), entry(2), entry(3, 1, 10), entry(4, 2, 9)];
    const summary = (id: number, tier: number, grade: number, price: number) => ({
      card_id: id, tier, psa_grade: grade, [definitionsTable]: definition(id),
      best_buy_price: price, best_buy_normalized: price, best_buy_currency: "USD", best_buy_kind: "bid", best_sell_price: 2,
      best_sell_normalized: 2, best_sell_currency: "USD", best_sell_kind: "ask", net_roi: String(price), roi: 999,
    });
    mock.tables[`${game}_price_summaries`] = [summary(1, 2, 0, 20), summary(1, 1, 0, 10), summary(2, 4, 0, 40), summary(2, 2, 0, 30), summary(1, -1, 10, 50)];
    mock.tables[definitionsTable] = [definition(2)];
    await mount(4);
    expect(mock.visible.map((row) => row.roi)).toEqual([10, 30, 50, null]);
    expect(mock.visible[0]).toMatchObject({ prices: { highestBuy: { price: 10, kind: "bid" }, lowestSell: { price: 2, kind: "ask" } } });
    expect(mock.visible[3]).toMatchObject({ psaGrade: 9, card: { regional_name: "Card 2" }, prices: { highestBuy: null, lowestSell: null } });
    expect(catalogReads().every((read) => read.ids?.length === 1 && Number(read.ids[0]) === 2)).toBe(true);
  });

  it("uses the last value for a repeated raw summary key while preserving first-key precedence", async () => {
    mock.cap = 1;
    mock.tables.pokemon_buylist_entries = [entry(1)];
    mock.tables.pokemon_price_summaries = [
      { card_id: 1, tier: 2, psa_grade: 0, pokemon_card_definitions: definition(1), net_roi: 20 },
      { card_id: 1, tier: 2, psa_grade: 0, pokemon_card_definitions: definition(1), net_roi: 30 },
      { card_id: 1, tier: 3, psa_grade: 0, pokemon_card_definitions: definition(1), net_roi: 40 },
    ];
    await mount(1);
    expect(mock.visible[0].roi).toBe(30);
    expect(catalogReads()).toEqual([]);
  });

  it.each([false, true])("keeps the selected list when the previous request finishes late (failure=%s)", async (failure) => {
    mock.tables.pokemon_buylist_entries = [entry(1), { ...entry(2), buylist_id: 2 }];
    mock.tables.pokemon_card_definitions = [definition(1), definition(2)];
    mock.holdList = 1;
    if (failure) { mock.errorTable = "pokemon_buylist_entries"; mock.errorList = 1; }
    const view = render(<BuyListView buylistId={1} />);
    await waitFor(() => expect(mock.release).not.toBeNull());
    view.rerender(<BuyListView buylistId={2} />);
    await screen.findByText("1 entries");
    expect(mock.visible[0].key).toBe("pokemon:2");
    expect(mock.reads[0].signal?.aborted).toBe(true);
    await act(async () => { mock.release?.(); });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("1 entries")).toBeTruthy();
    expect(mock.visible[0].key).toBe("pokemon:2");
  });

  it.each(["pokemon", "pokemon_sealed"])("ignores a late %s removal refresh after changing lists", async (game) => {
    const makeEntry = game === "pokemon" ? entry : sealedEntry;
    mock.tables[`${game}_buylist_entries`] = [makeEntry(1), { ...makeEntry(2), buylist_id: 2 }];
    let release!: () => void;
    mock.remove.mockImplementation(() => new Promise<void>((done) => { release = done; }));
    const view = render(<BuyListView buylistId={1} />);
    await screen.findByText("1 entries");
    fireEvent.click(screen.getByRole("button", { name: "open first" }));
    const removal = mock.modalRemove!();
    expect(mock.remove).toHaveBeenCalledWith(game, 1);
    view.rerender(<BuyListView buylistId={2} />);
    await waitFor(() => expect(mock.visible[0]?.key).toBe(`${game}:2`));
    const reads = mock.reads.length;
    const activeSignal = mock.reads.at(-1)?.signal;
    await act(async () => { release(); await removal; });
    expect(mock.reads).toHaveLength(reads);
    expect(activeSignal?.aborted).toBe(false);
    expect(mock.visible[0].key).toBe(`${game}:2`);
  });

  it("does not start a refresh when a removal completes after unmount", async () => {
    mock.tables.pokemon_buylist_entries = [entry(1)];
    let release!: () => void;
    mock.remove.mockImplementation(() => new Promise<void>((done) => { release = done; }));
    const view = render(<BuyListView buylistId={1} />);
    await screen.findByText("1 entries");
    fireEvent.click(screen.getByRole("button", { name: "open first" }));
    const removal = mock.modalRemove!();
    view.unmount();
    const reads = mock.reads.length;
    await act(async () => { release(); await removal; });
    expect(mock.reads).toHaveLength(reads);
  });

  it("rejects an older lifecycle's refresh even after returning to the same list ID", async () => {
    mock.tables.pokemon_buylist_entries = [entry(1), { ...entry(2), buylist_id: 2 }];
    let release!: () => void;
    mock.remove.mockImplementation(() => new Promise<void>((done) => { release = done; }));
    const view = render(<BuyListView buylistId={1} />);
    await screen.findByText("1 entries");
    fireEvent.click(screen.getByRole("button", { name: "open first" }));
    const removal = mock.modalRemove!();
    view.rerender(<BuyListView buylistId={2} />);
    await waitFor(() => expect(mock.visible[0]?.key).toBe("pokemon:2"));
    view.rerender(<BuyListView buylistId={1} />);
    await waitFor(() => expect(mock.visible[0]?.key).toBe("pokemon:1"));
    const reads = mock.reads.length;
    await act(async () => { release(); await removal; });
    expect(mock.reads).toHaveLength(reads);
  });

  it("matches sealed condition and edition exactly and batches only the missing variant", async () => {
    mock.tables.pokemon_sealed_buylist_entries = [sealedEntry(1, 7), sealedEntry(2, 7, "no_shrink"), sealedEntry(3, 7, "shrink", "1ed")];
    mock.tables.pokemon_sealed_summaries_v = [
      { card_id: 7, sealed_condition: "shrink", variant_edition: "unlimited", regional_name: "Box", product_type: "booster_box", language: "ja", best_buy_price: 100, best_buy_kind: "bid", net_roi: 25 },
      { card_id: 7, sealed_condition: "shrink", variant_edition: "1ed", regional_name: "First box", product_type: "booster_box", language: "ja", best_buy_price: 200, best_buy_kind: "sold", net_roi: 50 },
    ];
    mock.tables.pokemon_sealed_products = [{ product_id: 7, name: "Fallback box", product_type: "booster_box", language: "ja" }];
    await mount(3);
    expect(mock.visible.map((row) => [row.key, row.sealedCondition, row.variantEdition, row.roi]))
      .toEqual([["pokemon_sealed:1", "shrink", "unlimited", 25], ["pokemon_sealed:2", "no_shrink", "unlimited", null], ["pokemon_sealed:3", "shrink", "1ed", 50]]);
    expect(mock.visible[1]).toMatchObject({ card: { regional_name: "Fallback box" }, productType: "booster_box", language: "ja", prices: { highestBuy: null, lowestSell: null } });
    expect(mock.visible[2]).toMatchObject({ prices: { highestBuy: { price: 200, kind: "sold" } } });
    expect(catalogReads()).toHaveLength(2);
    expect(catalogReads().every((read) => read.ids?.length === 1 && read.ids[0] === 7)).toBe(true);
  });

  it("skips catalog fallback entirely when each entry has a usable summary", async () => {
    mock.tables.pokemon_buylist_entries = [entry(1)];
    mock.tables.pokemon_price_summaries = [{ card_id: 1, tier: 1, psa_grade: 0, pokemon_card_definitions: definition(1) }];
    await mount(1);
    expect(catalogReads()).toEqual([]);
  });

  it("keeps missing definitions as unknown entries without dropping variant identity", async () => {
    mock.tables.pokemon_buylist_entries = [entry(7)];
    mock.tables.mtg_buylist_entries = [entry(7, 8, 10)];
    mock.tables.pokemon_sealed_buylist_entries = [sealedEntry(7, 9, "no_shrink", "1ed")];
    await mount(3);
    expect(mock.visible.map((row) => row.key)).toEqual(["pokemon:7", "mtg:7", "pokemon_sealed:7"]);
    expect(mock.visible.every((row) => (row.card as Row).regional_name === "Unknown")).toBe(true);
    expect(mock.visible[2]).toMatchObject({ sealedCondition: "no_shrink", variantEdition: "1ed", targetPriceUsd: 7.5 });
  });

  it.each(["pokemon_card_definitions", "pokemon_buylist_entries", "pokemon_price_summaries"])("surfaces %s failures with retry instead of unknown cards or endless loading", async (table) => {
    mock.tables.pokemon_buylist_entries = [entry(1)];
    mock.tables.pokemon_card_definitions = [definition(1)];
    mock.errorTable = table;
    render(<BuyListView buylistId={1} />);
    await screen.findByRole("alert");
    expect(mock.visible).toEqual([]);
    mock.errorTable = "";
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    await screen.findByText("1 entries");
    expect(mock.visible[0]).toMatchObject({ card: { regional_name: "Card 1" } });
  });
});
