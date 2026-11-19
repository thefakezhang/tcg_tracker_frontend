// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "./GameContext";

type Row = Record<string, unknown>;
const mock = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  visible: [] as Record<string, unknown>[],
  writes: [] as { table: string; patch: Record<string, unknown>; filters: [string, unknown][] }[],
  activeGame: "pokemon" as "pokemon" | "mtg" | "pokemon_sealed",
  writeError: false,
  holdWrite: false,
  release: undefined as (() => void) | undefined,
  header: vi.fn(),
}));
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./LanguageContext", () => ({ useLanguage: () => ({ language: "en" }) }));
vi.mock("./GameContext", () => ({ useGame: () => ({ activeGame: mock.activeGame, setActiveGame: (game: Game) => { mock.activeGame = game; } }) }));
vi.mock("./HeaderContext", () => ({ useHeader: () => ({ setHeaderActions: mock.header }) }));
vi.mock("./BuyListContext", () => ({ useBuyList: () => ({ buylists: [], removeFromBuylist: vi.fn(), addToBuylist: vi.fn() }) }));
vi.mock("./CurrencyContext", () => ({ useCurrency: () => ({ displayCurrency: "JPY", convertPrice: (price: number) => ({ price: price * 150, symbol: "¥" }) }) }));
vi.mock("@/lib/use-fx-rate", () => ({ useFxRate: () => ({ rateFor: () => 150 }), fmtRate: () => "150" }));
vi.mock("./columns", () => ({ createBuylistColumns: () => [], PriceCell: () => null, TargetPriceCell: () => null }));
vi.mock("./ExportBuyListModal", () => ({ default: () => null }));
vi.mock("./data-table", () => ({ DataTable: ({ data, loading, onRowClick }: { data: Row[]; loading: boolean; onRowClick: (row: Row) => void }) => {
  mock.visible = data;
  return loading ? <div>loading entries</div> : <div>{data.map((row) => <button key={String(row.key)} onClick={() => onRowClick(row)}>{String(row.game)}</button>)}</div>;
} }));
vi.mock("./use-card-data", async (importOriginal) => ({
  ...await importOriginal<typeof import("./use-card-data")>(),
  fetchRateMap: vi.fn().mockResolvedValue(new Map()),
  fetchLocationMap: vi.fn().mockResolvedValue(new Map()),
  refreshLocationMap: vi.fn().mockResolvedValue(new Map()),
  fetchConditionsCache: vi.fn().mockResolvedValue({ map: new Map(), tiers: [1] }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  rpc: async () => ({ data: [], error: null }),
  from: (table: string) => {
    const filters: [string, unknown][] = [];
    let ids: { col: string; values: unknown[] } | undefined;
    let start = 0, end = Infinity, single = false;
    let patch: Row | undefined;
    const query = {
      select: () => query, order: () => query, abortSignal: () => query, gt: () => query,
      eq: (col: string, value: unknown) => { filters.push([col, value]); return query; },
      in: (col: string, values: unknown[]) => { ids = { col, values }; return query; },
      range: (from: number, to: number) => { start = from; end = to; return query; },
      maybeSingle: () => { single = true; return query; },
      update: (value: Row) => { patch = value; return query; },
      then: async (resolve: (value: unknown) => unknown) => {
        const rows = (mock.tables[table] ?? []).filter((row) => filters.every(([col, value]) => String(row[col]) === String(value)) && (!ids || ids.values.some((value) => String(row[ids!.col]) === String(value))));
        if (patch) {
          mock.writes.push({ table, patch, filters });
          if (mock.holdWrite) await new Promise<void>((done) => { mock.release = done; });
          if (mock.writeError) return resolve({ data: null, error: { message: "write denied" } });
          for (const row of rows) Object.assign(row, patch);
          return resolve({ data: null, error: null });
        }
        return resolve({ data: single ? rows[0] ?? null : rows.slice(start, end + 1), error: null });
      },
    };
    return query;
  },
}) }));

vi.mock("./owned-inventory", () => ({
  useOwnedInventoryVersion: () => 0,
  bumpOwnedInventory: vi.fn(),
}));
vi.mock("./AddToLotPopover", () => ({ AddToLotPopover: () => null }));
vi.mock("./UidChip", () => ({ UidChip: () => null }));
vi.mock("./FreshnessChip", () => ({ FreshnessChip: () => null }));
vi.mock("./GradeEvidencePanel", () => ({ default: () => null }));
vi.mock("./DecisionActions", () => ({
  decisionSnapshot: () => ({}),
  // The modal renders the Watch control beside Add to Buy List; this
  // suite is about target-price identity, so the control is stubbed rather than
  // exercised (DecisionActions.test.tsx covers it).
  DecisionActions: () => null,
}));
vi.mock("./opportunity-exposures", () => ({
  detailOpportunityPayloads: () => [],
  recordOpportunityExposures: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./MarketEvidenceCallout", () => ({ MarketEvidenceCallout: () => null }));
vi.mock("./JapanExclusiveEvidence", () => ({ JapanExclusiveEvidence: () => null }));
vi.mock("./PokemonCuratorFlags", () => ({
  PokemonCuratorFlagSwitches: () => null,
  pokemonCuratorFlagValues: () => ({ is_cute: false }),
}));
vi.mock("./PokemonJapanExclusivityEditor", () => ({
  PokemonJapanExclusivityEditor: () => null,
  pokemonJapanExclusivityValues: () => ({
    japan_exclusive_artwork: false,
    japan_exclusive_artwork_reason: null,
    japan_exclusive_artwork_evidence_url: null,
    japan_exclusive_stamps: false,
    japan_exclusive_stamps_reason: null,
    japan_exclusive_stamps_evidence_url: null,
  }),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children, onOpenChange }: { open: boolean; children: React.ReactNode; onOpenChange?: (open: boolean) => void }) =>
    open ? <div role="dialog">{children}<button onClick={() => onOpenChange?.(false)}>close detail</button></div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));


import BuyListView from "./BuyListView";

const games: Game[] = ["pokemon", "mtg", "pokemon_sealed"];
function prices() { return mock.visible.map((row) => row.targetPriceUsd); }
function input() {
  const label = within(screen.getByRole("dialog")).getByText("buyList.targetPrice");
  return label.parentElement!.querySelector("input")!;
}
async function open(game: Game) {
  fireEvent.click(await screen.findByRole("button", { name: game }));
  await screen.findByRole("dialog");
}
function save(value: string) {
  fireEvent.change(input(), { target: { value } });
  fireEvent.keyDown(input(), { key: "Enter" });
}
function expected(game: Game, value: number | null) { return games.map((candidate, i) => candidate === game ? value : (i + 1) * 10); }

afterEach(cleanup);
beforeEach(() => {
  mock.activeGame = "pokemon"; mock.writes = []; mock.visible = []; mock.writeError = false; mock.holdWrite = false; mock.release = undefined;
  mock.tables = {};
  games.forEach((game, index) => {
    mock.tables[`${game}_buylist_entries`] = [{ buylist_id: 1, entry_id: 7, card_id: index + 1, product_id: index + 1, psa_grade: 0, sealed_condition: "shrink", variant_edition: "unlimited", target_price_usd: (index + 1) * 10 }];
  });
  mock.tables.pokemon_card_definitions = [{ card_id: 1, regional_name: "Pokemon card", set_code: "S" }];
  mock.tables.mtg_card_definitions_v = [{ card_id: 2, regional_name: "MTG card", set_code: "S" }];
  mock.tables.pokemon_sealed_products = [{ product_id: 3, name: "Sealed box", product_type: "booster_box", language: "ja" }];
});

describe("buy-list target prices with colliding entry IDs", () => {
  it.each(games.flatMap((game) => [{ game, text: "12.50", value: 12.5 }, { game, text: "0", value: 0 }, { game, text: "", value: null }]))("saves $game target '$text' to its table and changes only that row", async ({ game, text, value }) => {
    render(<BuyListView buylistId={1} />);
    await open(game);
    save(text);
    await waitFor(() => expect(mock.writes).toHaveLength(1));
    expect(mock.writes).toEqual([{ table: `${game}_buylist_entries`, patch: { target_price_usd: value }, filters: [["entry_id", 7]] }]);
    await waitFor(() => expect(prices()).toEqual(expected(game, value)));
    expect(games.map((candidate) => mock.tables[`${candidate}_buylist_entries`][0].target_price_usd)).toEqual(expected(game, value));
    // The modal synchronizes its input in an effect after the row update.
    await waitFor(() => expect(input().value).toBe(value == null ? "" : String(value)));
  });

  it.each(games)("keeps all rows unchanged when the %s save is rejected", async (game) => {
    mock.writeError = true;
    render(<BuyListView buylistId={1} />);
    await open(game);
    save("99.25");
    await screen.findByRole("alert");
    expect(prices()).toEqual([10, 20, 30]);
    expect(games.map((candidate) => mock.tables[`${candidate}_buylist_entries`][0].target_price_usd)).toEqual([10, 20, 30]);
    expect(mock.writes).toEqual([{ table: `${game}_buylist_entries`, patch: { target_price_usd: 99.25 }, filters: [["entry_id", 7]] }]);
    mock.writeError = false;
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(prices()).toEqual(expected(game, 99.25)));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mock.writes).toHaveLength(2);
    expect(mock.writes.every((write) => write.table === `${game}_buylist_entries`)).toBe(true);
  });

  it("keeps the newly selected game's detail unchanged when an earlier save finishes", async () => {
    mock.holdWrite = true;
    render(<BuyListView buylistId={1} />);
    await open("pokemon");
    save("45.67");
    await waitFor(() => expect(mock.release).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "close detail" }));
    await open("mtg");
    expect(input().value).toBe("20");
    await act(async () => { mock.release?.(); });
    expect(prices()).toEqual([45.67, 20, 30]);
    expect(input().value).toBe("20");
    expect(mock.writes[0].table).toBe("pokemon_buylist_entries");
  });
});
