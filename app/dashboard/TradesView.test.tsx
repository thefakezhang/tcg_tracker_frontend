// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "./LanguageContext";

const mocks = vi.hoisted(() => ({
  mainError: null as Error | null,
  searchError: null as Error | null,
  mainData: [] as unknown[],
  searchData: [] as unknown[],
  rpc: vi.fn(),
  conditions: [
    { condition_id: 1, code: "NM", display_name: "Near Mint", standard: "tcgplayer" },
    { condition_id: 2, code: "LP", display_name: "Lightly Played", standard: "tcgplayer" },
  ] as unknown[],
}));

vi.mock("@/lib/supabase/client", () => ({
  // The basket's condition picker reads `conditions` directly; everything else
  // it needs comes through the mocked useSupabaseQuery below.
  createClient: () => ({
    rpc: mocks.rpc,
    // The condition lookup now reads every standard, so select() is awaited
    // directly with no .eq() narrowing it. Keeping .eq() available means this
    // fake does not care which of the two shapes the component uses.
    from: () => {
      const result = Promise.resolve({ data: mocks.conditions });
      return {
        select: () => Object.assign(result, {
          eq: () => result,
          then: result.then.bind(result),
        }),
      };
    },
  }),
}));

vi.mock("./use-query", () => ({
  QueryError: ({ error }: { error: Error }) => <div role="alert">{error.message}</div>,
  useSupabaseQuery: (key: string | null) => {
    if (key == null) {
      return { data: undefined, error: undefined, isLoading: false, retry: vi.fn() };
    }
    const isSearch = key.startsWith("trades:search:");
    const error = isSearch ? mocks.searchError : mocks.mainError;
    return {
      data: isSearch ? mocks.searchData : mocks.mainData,
      error: error ?? undefined,
      isLoading: false,
      retry: vi.fn(),
    };
  },
}));

import TradesView, { conditionText, fetchTrades, searchForBasket } from "./TradesView";

afterEach(cleanup);

beforeEach(() => {
  mocks.mainError = null;
  mocks.searchError = null;
  mocks.mainData = [];
  mocks.searchData = [];
  mocks.rpc.mockReset().mockResolvedValue({ error: null });
});

function row(id: number) {
  return {
    trade_id: id,
    traded_at: "2026-10-01",
    counterparty: `Counterparty ${id}`,
    cash_usd: 0,
    sale_group: id,
    value_out_usd: 10,
    lot_id: id,
    value_in_usd: 10,
    balanced: true,
    imbalance_usd: 0,
    notes: null,
  };
}

function pagedClient(rows: ReturnType<typeof row>[]) {
  const ranges: Array<[number, number]> = [];
  return {
    ranges,
    client: {
      from: vi.fn(() => ({
        select: vi.fn(() => {
          const builder = {
            order: vi.fn(() => builder),
            range: vi.fn(async (from: number, to: number) => {
              ranges.push([from, to]);
              return { data: rows.slice(from, to + 1), error: null };
            }),
          };
          return builder;
        }),
      })),
    },
  };
}

describe("TradesView data contracts", () => {
  it("pages beyond the old 200-row cap with a total order", async () => {
    const rows = Array.from({ length: 1205 }, (_, index) => row(index + 1));
    const { client, ranges } = pagedClient(rows);

    const result = await fetchTrades(client as never);

    expect(result).toHaveLength(1205);
    expect(result[0].trade_id).toBe(1205);
    expect(result.at(-1)?.trade_id).toBe(1);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [1205, 2204]]);
  });

  it("surfaces a trade-list read failure", () => {
    mocks.mainError = new Error("trade list unavailable");
    render(<LanguageProvider><TradesView /></LanguageProvider>);

    expect(screen.getByRole("alert").textContent).toContain("trade list unavailable");
  });

  it("surfaces a card-search failure inside the record dialog", async () => {
    mocks.searchError = new Error("card search unavailable");
    render(<LanguageProvider><TradesView /></LanguageProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Record trade" }));
    // A search only runs once there is a term, so type one.
    fireEvent.change(screen.getAllByPlaceholderText("Search name, set or number")[0], {
      target: { value: "pikachu" },
    });

    expect((await screen.findByRole("alert")).textContent).toContain("card search unavailable");
  });

  // The whole reason record_trade exists: the operator gives ONE value and the
  // other side is derived, so the two halves cannot be entered inconsistently.
  it("will not submit until both baskets have cards and a value is set", async () => {
    mocks.searchData = [
      { game: "pokemon", itemId: 1, conditionId: 1, psaGrade: 0, label: "Pikachu M2A 234", available: 1 },
    ];
    render(<LanguageProvider><TradesView /></LanguageProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Record trade" }));
    const submit = () => screen.getAllByRole("button", { name: "Record trade" }).at(-1)!;

    // Nothing picked: refused.
    expect((submit() as HTMLButtonElement).disabled).toBe(true);

    // Cards on both sides but no agreed value: still refused.
    const boxes = screen.getAllByPlaceholderText("Search name, set or number");
    for (const box of boxes) {
      fireEvent.change(box, { target: { value: "pika" } });
      fireEvent.click((await screen.findAllByRole("button", { name: /Pikachu/ }))[0]);
    }
    expect((submit() as HTMLButtonElement).disabled).toBe(true);

    // With a value it is recordable, and the RPC gets the one number plus the
    // signed cash, never a second value for the other side.
    fireEvent.change(screen.getByLabelText("Agreed value of what you gave (USD)", { exact: false }), {
      target: { value: "220" },
    });
    await waitFor(() => expect((submit() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submit());

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    const [fn, args] = mocks.rpc.mock.calls[0];
    expect(fn).toBe("record_trade");
    expect(args.p_value_out).toBe(220);
    expect(args.p_cash_usd).toBe(0);
    expect(args.p_items_out).toHaveLength(1);
    expect(args.p_items_in).toHaveLength(1);
    expect(args).not.toHaveProperty("p_value_in");
  });

  it("refuses cash back larger than the cards given, which would leave nothing coming in", async () => {
    mocks.searchData = [
      { game: "pokemon", itemId: 1, conditionId: 1, psaGrade: 0, label: "Pikachu M2A 234", available: 1 },
    ];
    render(<LanguageProvider><TradesView /></LanguageProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Record trade" }));
    for (const box of screen.getAllByPlaceholderText("Search name, set or number")) {
      fireEvent.change(box, { target: { value: "pika" } });
      fireEvent.click((await screen.findAllByRole("button", { name: /Pikachu/ }))[0]);
    }
    fireEvent.change(screen.getByLabelText("Agreed value of what you gave (USD)", { exact: false }), {
      target: { value: "100" },
    });
    // Two selects exist: the incoming basket's condition picker, then the
    // cash direction. Cash is last in DOM order.
    const dir = screen.getAllByRole("combobox").at(-1)!;
    fireEvent.change(dir, { target: { value: "received" } });
    const cash = screen.getAllByPlaceholderText("0.00").at(-1)!;
    fireEvent.change(cash, { target: { value: "150" } });

    const submit = screen.getAllByRole("button", { name: "Record trade" }).at(-1)!;
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(true));
  });

  it("surfaces a record failure and keeps the dialog open", async () => {
    mocks.searchData = [
      { game: "pokemon", itemId: 1, conditionId: 1, psaGrade: 0, label: "Pikachu M2A 234", available: 1 },
    ];
    mocks.rpc.mockResolvedValueOnce({ error: { message: "trade rejected" } });
    render(<LanguageProvider><TradesView /></LanguageProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Record trade" }));
    for (const box of screen.getAllByPlaceholderText("Search name, set or number")) {
      fireEvent.change(box, { target: { value: "pika" } });
      fireEvent.click((await screen.findAllByRole("button", { name: /Pikachu/ }))[0]);
    }
    fireEvent.change(screen.getByLabelText("Agreed value of what you gave (USD)", { exact: false }), {
      target: { value: "220" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Record trade" }).at(-1)!);

    expect((await screen.findByRole("alert")).textContent).toContain("trade rejected");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("confirms unlink visibly, keeps booked sides, and offers an inline retry on failure", async () => {
    mocks.mainData = [row(42)];
    mocks.rpc.mockResolvedValueOnce({ error: { message: "unlink rejected" } });
    render(<LanguageProvider><TradesView /></LanguageProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("The sale and the lot stay exactly as booked.");
    expect(mocks.rpc).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Unlink" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("unlink rejected"));
    expect(screen.getByText("Counterparty 42")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

// The outgoing basket reads inventory_holdings_v, whose `name` is the JAPANESE
// regional name for Pokemon. It shipped searching name/set/number only, so
// "pikachu" matched nothing there while the incoming basket, which reads the
// catalogue and sees english_name, matched 411 cards. The suite could not see
// that, because it mocks this function out. These pin the columns.
describe("searchForBasket", () => {
  function fakeSupabase() {
    const calls = { table: "", tables: [] as string[], select: "", filters: [] as string[], gt: [] as unknown[][] };
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    Object.assign(builder, {
      select: (cols: string) => { calls.select = cols; return chain(); },
      gt: (...args: unknown[]) => { calls.gt.push(args); return chain(); },
      eq: chain,
      or: (f: string) => { calls.filters.push(f); return chain(); },
      limit: () => Promise.resolve({ data: [] }),
      // externalIdMatches reads a platform table; an empty answer is fine here.
      in: chain,
    });
    return {
      calls,
      client: {
        from: (table: string) => {
          if (!calls.table) calls.table = table;
          calls.tables.push(table);
          return builder;
        },
      },
    };
  }

  it("searches the holdings view by english_name as well as the japanese name", async () => {
    const { calls, client } = fakeSupabase();
    await searchForBasket(client as never, "out", "pikachu", null);

    expect(calls.select).toContain("english_name");
    // One filter per whitespace token; each must offer english_name as a disjunct.
    expect(calls.filters.length).toBeGreaterThan(0);
    expect(calls.filters.every((f) => f.includes("english_name"))).toBe(true);
  });

  // The whole point of lib/card-search is that a pasted identifier lands on the
  // card, in every search bar. This basket used to aim uidCol at the integer
  // card_id with no external ids, which both dropped the paste paths AND made a
  // pasted uid emit `card_id.gte.<uuid>` - an error, not a miss.
  it("resolves a pasted uid against item_uid, not an integer id column", async () => {
    const { calls, client } = fakeSupabase();
    await searchForBasket(client as never, "out", "a1b2c3d4", null);

    const joined = calls.filters.join(" ");
    expect(joined).toContain("item_uid");
    expect(joined).not.toContain("card_id.gte");
    expect(joined).not.toContain("card_id.lte");
  });

  it("asks the platform-id resolver for the outgoing side too", async () => {
    const { calls, client } = fakeSupabase();
    await searchForBasket(client as never, "out", "123456", null);

    // externalIdMatches reads the identifier table before the holdings query,
    // so the outgoing basket accepts a pasted TCGplayer id like the rest.
    expect(calls.tables).toContain("pokemon_external_identifiers");
    expect(calls.tables).toContain("inventory_holdings_v");
  });

  it("asks only for stock on hand, so a sold-out holding cannot be given away", async () => {
    const { calls, client } = fakeSupabase();
    await searchForBasket(client as never, "out", "pikachu", null);

    expect(calls.gt).toEqual([["qty_on_hand", 0]]);
  });

  it("searches the catalogue for the incoming side, where we hold nothing yet", async () => {
    const { calls, client } = fakeSupabase();
    await searchForBasket(client as never, "in", "pikachu", 1);

    expect(calls.table).toBe("pokemon_external_identifiers");
    expect(calls.filters.some((f) => f.includes("english_name"))).toBe(true);
  });
});

// A holding's condition is part of WHICH card it is. Six cards in the live book
// appear two or three times told apart only by condition - Kangaskhan OLD-PJ is
// held Near Mint AND Damaged - so a row that omits it cannot be picked
// correctly, and the first version of this screen omitted it everywhere.
describe("conditionText", () => {
  const names = new Map([[1, "Near Mint"], [2, "Lightly Played"], [6, "ニアミント NM"]]);

  it("names the condition a single is held in", () => {
    expect(conditionText(
      { game: "pokemon", conditionId: 1, psaGrade: 0 } as never, names,
    )).toBe("Near Mint");
    expect(conditionText(
      { game: "pokemon", conditionId: 2, psaGrade: 0 } as never, names,
    )).toBe("Lightly Played");
  });

  it("handles a non-tcgplayer standard, because stock comes from JP shops too", () => {
    expect(conditionText(
      { game: "mtg", conditionId: 6, psaGrade: 0 } as never, names,
    )).toBe("ニアミント NM");
  });

  it("prefers the grade for a slab, which is its condition", () => {
    expect(conditionText(
      { game: "pokemon", conditionId: 1, psaGrade: 10 } as never, names,
    )).toBe("PSA 10");
  });

  it("falls back to the id rather than rendering nothing for an unknown condition", () => {
    expect(conditionText(
      { game: "pokemon", conditionId: 99, psaGrade: 0 } as never, names,
    )).toBe("condition 99");
  });

  it("describes sealed by its own axes, which have no condition_id", () => {
    expect(conditionText(
      { game: "pokemon_sealed", conditionId: null, psaGrade: 0,
        sealedCondition: "shrink", variantEdition: "1ed" } as never, names,
    )).toBe("shrink 1ed");
    // "standard" on both axes is the unremarkable case and reads as noise.
    expect(conditionText(
      { game: "pokemon_sealed", conditionId: null, psaGrade: 0,
        sealedCondition: "standard", variantEdition: "standard" } as never, names,
    )).toBe("sealed");
  });
});

describe("search result labels", () => {
  it("keeps the condition out of the label so it cannot be truncated away", async () => {
    const calls = { select: "", filters: [] as string[] };
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    Object.assign(builder, {
      select: (c: string) => { calls.select = c; return chain(); },
      gt: chain, eq: chain, in: chain,
      or: (f: string) => { calls.filters.push(f); return chain(); },
      limit: () => Promise.resolve({
        // A slab, so the assertion below actually discriminates: with the grade
        // folded back into the label the first expect fails. With psa_grade 0
        // that branch yields null either way and the test proves nothing.
        data: [{
          game: "pokemon", card_id: 1, product_id: null, item_uid: null,
          name: "ピカチュウ", english_name: "Pikachu", set_code: "CLL",
          card_number: "008/032", condition_id: 1, psa_grade: 10, qty_on_hand: 5,
          sealed_condition: null, variant_edition: null, variant_label: null,
        }],
      }),
    });
    const hits = await searchForBasket(
      { from: () => builder } as never, "out", "kangaskhan", null,
    );

    expect(hits[0].label).toBe("Pikachu CLL 008/032");
    expect(hits[0].label).not.toContain("PSA");
    // The caller renders the condition from these, so the hit must carry them.
    expect(hits[0].psaGrade).toBe(10);
    expect(hits[0].conditionId).toBe(1);
    expect(hits[0].available).toBe(5);
  });
});
