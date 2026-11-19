// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardRowData, LocationInfo } from "./use-card-data";

type Row = Record<string, unknown>;
type Read = {
  table: string; columns: string; cardId: string; signal?: AbortSignal;
  done: boolean; resolve: (result: { data: unknown; error: null }) => void;
};
const mock = vi.hoisted(() => ({
  game: "pokemon" as "pokemon" | "mtg",
  ownedVersion: 0,
  reads: [] as Read[],
  rpc: vi.fn(),
  rates: vi.fn(), locations: vi.fn(), conditions: vi.fn(), refresh: vi.fn(),
}));
vi.mock("@/lib/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./LanguageContext", () => ({ useLanguage: () => ({ language: "en" }) }));
vi.mock("./GameContext", () => ({ useGame: () => ({ activeGame: mock.game }) }));
vi.mock("./CurrencyContext", () => ({ useCurrency: () => ({ displayCurrency: "none", convertPrice: (price: number) => ({ price, symbol: "$" }) }) }));
vi.mock("./BuyListContext", () => ({ useBuyList: () => ({ buylists: [], addToBuylist: vi.fn() }) }));
vi.mock("@/lib/use-fx-rate", () => ({ useFxRate: () => ({ rateFor: () => 1 }), fmtRate: () => "1" }));
vi.mock("./owned-inventory", () => ({ useOwnedInventoryVersion: () => mock.ownedVersion, bumpOwnedInventory: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  rpc: mock.rpc,
  from: (table: string) => {
    let resolve!: Read["resolve"];
    const pending = new Promise<{ data: unknown; error: null }>((done) => { resolve = done; });
    const read: Read = { table, columns: "", cardId: "", done: false, resolve };
    const query = {
      select: (columns: string) => { read.columns = columns; return query; },
      eq: (column: string, value: unknown) => { if (column === "card_id") read.cardId = String(value); return query; },
      gt: () => query, order: () => query, maybeSingle: () => query,
      // Deliberately ignore abort: fencing must work even if a transport finishes late.
      abortSignal: (signal: AbortSignal) => { read.signal = signal; return query; },
      then: (fulfilled: (result: { data: unknown; error: null }) => unknown, rejected?: (error: unknown) => unknown) => {
        mock.reads.push(read);
        return pending.then(fulfilled, rejected);
      },
    };
    return query;
  },
}) }));
vi.mock("./use-card-data", async (original) => ({
  ...await original<typeof import("./use-card-data")>(),
  fetchRateMap: mock.rates, fetchLocationMap: mock.locations,
  fetchConditionsCache: mock.conditions, refreshLocationMap: mock.refresh,
}));
vi.mock("./AddToLotPopover", () => ({ AddToLotPopover: () => null }));
vi.mock("./UidChip", () => ({ UidChip: () => null }));
vi.mock("./FreshnessChip", () => ({ FreshnessChip: () => null }));
vi.mock("./GradeEvidencePanel", () => ({ default: () => null }));
vi.mock("./DecisionActions", async (original) => ({
  ...await original<typeof import("./DecisionActions")>(), DecisionActions: () => null,
}));
vi.mock("./MarketEvidenceCallout", () => ({ MarketEvidenceCallout: () => null }));
vi.mock("./JapanExclusiveEvidence", () => ({ JapanExclusiveEvidence: () => null }));
vi.mock("./PokemonCuratorFlags", () => ({ PokemonCuratorFlagSwitches: () => null, pokemonCuratorFlagValues: () => ({ is_cute: false }) }));
vi.mock("./PokemonJapanExclusivityEditor", () => ({ PokemonJapanExclusivityEditor: () => null, pokemonJapanExclusivityValues: () => ({}) }));

import CardDetailModal from "./CardDetailModal";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function locations(name = "Current shop", id = 1) {
  return new Map<number, LocationInfo>([[id, { name, marketRegion: "JP" }]]);
}
function card(id: number): CardRowData {
  return { key: String(id), card: { card_id: String(id), regional_name: `Card ${id}`, english_name: `Card ${id}`, set_code: "TEST", card_number: String(id), misc_info: null, image_url: null, language: "jp" }, prices: { highestBuy: null, lowestSell: null }, roi: null };
}
const a = card(11), b = card(22);
function modal(row = a, open = true) { return <CardDetailModal card={row} open={open} onClose={vi.fn()} />; }
function pending(id: number) { return mock.reads.filter((read) => read.cardId === String(id) && !read.done); }
async function ready(id: number) {
  await waitFor(() => expect(pending(id)).toHaveLength(mock.game === "pokemon" ? 8 : 6));
}
async function finish(id: number, locationId = 1, heldQty = id) {
  await act(async () => {
    for (const read of pending(id)) {
      read.done = true;
      let data: unknown = [];
      if (read.table.endsWith("market_listings")) data = [{ card_id: id, price_type: "Sell", price_kind: "ask", price: id, currency: "USD", currencies: { symbol: "$" }, psa_grade: 0, condition: 1, location_id: locationId, listing_url: `https://example.test/card/${id}`, last_updated: "2026-11-19T01:00:00Z" }];
      if (read.table === "inventory_holdings_v") data = [{ condition_id: 1, psa_grade: 0, qty_on_hand: heldQty }];
      if (read.table === "owned_inventory_counts_v") data = [{ qty_incoming: heldQty }];
      if (read.table.endsWith("lot_lines")) data = [{ line_id: id * 100, quantity: 2, qty_remaining: 2, consigned_qty: 0, allocated_cost_usd: 20, direct_purchase_cost_usd: 10, acquisition_lots: { shop_label: `Owned source ${id}`, acquired_at: "2026-11-01", leg: "import", trips: null } }];
      if (read.table === "trip_observations_v") data = [{ sighting_id: id, psa_grade: 0, store_name: `Observed source ${id}`, observed_price: id, currency: "USD", price_usd: id, observed_at: "2026-11-01", trip_name: null }];
      if (read.table === "pokemon_tcgplayer_market") data = { market_usd: 30 };
      read.resolve({ data, error: null });
    }
  });
}
function exposures() { return mock.rpc.mock.calls.filter(([name]) => name === "record_deal_opportunity_exposures").flatMap(([, args]) => args.p_exposures as Row[]); }
function expectPending() {
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(screen.queryAllByText(/^Owned source /)).toHaveLength(0);
  expect(screen.queryAllByText(/^Observed source /)).toHaveLength(0);
  expect(screen.queryByText("inventory.sellLine")).toBeNull();
}
function expectCard(id: number) {
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByText(`Card ${id}`)).toBeTruthy();
  expect(screen.getByRole("tablist")).toBeTruthy();
  expect(screen.getAllByText(new RegExp(`^Owned source ${id}`)).length).toBeGreaterThan(0);
  expect(screen.getByRole("link", { name: "Current shop" }).getAttribute("href")).toBe(`https://example.test/card/${id}`);
}

beforeEach(() => {
  mock.game = "pokemon"; mock.ownedVersion = 0; mock.reads = [];
  mock.rpc.mockReset().mockResolvedValue({ data: null, error: null });
  mock.rates.mockReset().mockResolvedValue(new Map([["USD", 1]]));
  mock.locations.mockReset().mockResolvedValue(locations());
  mock.conditions.mockReset().mockResolvedValue({ map: new Map([[1, 1]]), tiers: [1] });
  mock.refresh.mockReset().mockResolvedValue(locations());
});
afterEach(cleanup);

describe("CardDetailModal current load", () => {
  it("does not let A's late metadata expose its listings or clear B's loading", async () => {
    const refresh = deferred<Map<number, LocationInfo>>();
    mock.refresh.mockReturnValueOnce(refresh.promise);
    const view = render(modal(a)); await ready(11); await finish(11, 9);
    expect(mock.refresh).toHaveBeenCalledTimes(1);
    view.rerender(modal(b)); await ready(22);
    await act(async () => { refresh.resolve(locations("Obsolete shop", 9)); });
    expectPending(); expect(exposures()).toEqual([]);
    await finish(22); expectCard(22);
    expect(exposures().map((entry) => entry.card_id)).toEqual([22]);
  });

  it("ignores A's late refreshed map after B has completed", async () => {
    const refresh = deferred<Map<number, LocationInfo>>();
    mock.refresh.mockReturnValueOnce(refresh.promise);
    const view = render(modal(a)); await ready(11); await finish(11, 9);
    view.rerender(modal(b)); await ready(22); await finish(22);
    await act(async () => { refresh.resolve(locations("Obsolete shop", 9)); });
    expectCard(22); expect(exposures().map((entry) => entry.card_id)).toEqual([22]);
  });

  it.each(["close", "unmount"] as const)("does not record after %s while metadata is pending", async (action) => {
    const refresh = deferred<Map<number, LocationInfo>>();
    mock.refresh.mockReturnValueOnce(refresh.promise);
    const view = render(modal(a)); await ready(11); await finish(11, 9);
    if (action === "close") view.rerender(modal(a, false)); else view.unmount();
    await act(async () => { refresh.resolve(locations("Obsolete shop", 9)); });
    expect(exposures()).toEqual([]);
  });

  it("keeps distinct generations when A returns after B", async () => {
    const refresh = deferred<Map<number, LocationInfo>>();
    mock.refresh.mockReturnValueOnce(refresh.promise);
    const view = render(modal(a)); await ready(11); await finish(11, 9);
    view.rerender(modal(b)); await ready(22);
    view.rerender(modal(a)); await ready(11);
    await act(async () => { refresh.resolve(locations("Obsolete shop", 9)); });
    expectPending(); expect(exposures()).toEqual([]);
    await finish(22); expectPending();
    await finish(11); expectCard(11);
    expect(exposures().map((entry) => entry.card_id)).toEqual([11]);
  });

  it.each(["switch", "reopen", "inventory"] as const)("hides completed old holdings and sale controls during %s", async (action) => {
    const view = render(modal(a)); await ready(11); await finish(11); expectCard(11);
    if (action === "switch") view.rerender(modal(b));
    if (action === "reopen") { view.rerender(modal(a, false)); view.rerender(modal(a)); }
    if (action === "inventory") { mock.ownedVersion += 1; view.rerender(modal(a)); }
    const id = action === "switch" ? 22 : 11;
    await ready(id); expectPending();
    await finish(id); expectCard(id);
  });

  it("aborts only owned reads and ignores their late responses", async () => {
    const rates = deferred<Map<string, number>>();
    mock.rates.mockReturnValue(rates.promise);
    const view = render(modal(a)); await ready(11);
    const oldReads = [...pending(11)];
    view.rerender(modal(b)); await ready(22);
    expect(oldReads.every((read) => read.signal?.aborted)).toBe(true);
    expect(pending(22).every((read) => read.signal && !read.signal.aborted)).toBe(true);
    expect(mock.rates.mock.calls.every((args) => args.length === 1)).toBe(true);
    expect(mock.locations.mock.calls.every((args) => args.length === 1)).toBe(true);
    expect(mock.conditions.mock.calls.every((args) => args.length === 1)).toBe(true);
    await finish(11); await finish(22);
    await act(async () => { rates.resolve(new Map([["USD", 1]])); });
    expectCard(22); expect(exposures().map((entry) => entry.card_id)).toEqual([22]);
  });

  it.each(["New shop", "collectr", "130point"])("uses refreshed %s metadata for labels and exposure policy", async (source) => {
    const refresh = deferred<Map<number, LocationInfo>>();
    mock.refresh.mockReturnValueOnce(refresh.promise);
    render(modal(a)); await ready(11); await finish(11, 9);
    expectPending(); expect(exposures()).toEqual([]);
    await act(async () => { refresh.resolve(locations(source, 9)); });
    expect(screen.getByRole("link", { name: source })).toBeTruthy();
    expect(exposures().map((entry) => entry.source_name)).toEqual(source === "New shop" ? [source] : []);
  });

  it.each(["close", "unmount"] as const)("aborts pending owned reads on %s", async (action) => {
    const view = render(modal(a)); await ready(11);
    const reads = [...pending(11)];
    if (action === "close") view.rerender(modal(a, false)); else view.unmount();
    expect(reads.every((read) => read.signal?.aborted)).toBe(true);
    await finish(11);
    expect(exposures()).toEqual([]);
  });

  it("ignores a prior inventory refresh even when the card object is unchanged", async () => {
    const refresh = deferred<Map<number, LocationInfo>>();
    mock.refresh.mockReturnValueOnce(refresh.promise);
    const view = render(modal(a)); await ready(11); await finish(11, 9);
    mock.ownedVersion += 1; view.rerender(modal(a)); await ready(11);
    await act(async () => { refresh.resolve(locations("Old inventory source", 9)); });
    expectPending(); expect(exposures()).toEqual([]);
    await finish(11, 1, 3); expectCard(11);
    expect(exposures().map((entry) => entry.card_id)).toEqual([11]);
  });

  it("does not reuse Pokemon results for MTG with the same card ID", async () => {
    const view = render(modal(a)); await ready(11); await finish(11);
    mock.game = "mtg"; view.rerender(modal(a)); await ready(11);
    expectPending(); await finish(11); expectCard(11);
    expect(exposures().map((entry) => entry.card_id)).toEqual([11]);
  });

  it("loads MTG independently without Pokemon-only reads or exposures", async () => {
    mock.game = "mtg";
    render(modal(a)); await ready(11); await finish(11); expectCard(11);
    expect(mock.reads.some((read) => read.table.startsWith("pokemon_") || read.table === "trip_observations_v")).toBe(false);
    expect(exposures()).toEqual([]);
    expect(within(screen.getByRole("tablist")).queryByRole("tab", { name: "modal.tabPsa" })).toBeNull();
  });
});
