// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../LanguageContext";
import SalesTab from "./SalesTab";

const transport = vi.hoisted(() => ({
  holdings: [] as Record<string, unknown>[],
  rpc: vi.fn(),
}));

// Keep the real view, importer, parser, matcher, paging and sale payload builder.
// Only the Supabase transport is replaced; every mutation remains observable.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: transport.rpc,
    from: (table: string) => {
      let start = 0;
      let end = Infinity;
      const data = () => {
        if (table === "inventory_holdings_v") return transport.holdings;
        if (table === "pokemon_card_definitions" || table === "mtg_card_definitions_v") {
          const game = table.startsWith("pokemon") ? "pokemon" : "mtg";
          return transport.holdings.filter((row) => row.game === game).map((row) => ({
            card_id: row.card_id, english_name: row.name, image_url: null,
          }));
        }
        if (table === "exchange_rates") return [{ from_currency: "JPY", to_currency: "USD", rate: 0.0067 }];
        if (table === "sales_ledger_v" || table === "customers") return [];
        throw new Error(`Unexpected read: ${table}`);
      };
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        range: (from: number, to: number) => { start = from; end = to; return query; },
        then: (resolve: (result: { data: Record<string, unknown>[]; error: null }) => unknown) =>
          Promise.resolve({ data: data().slice(start, end + 1), error: null }).then(resolve),
      };
      return query;
    },
  }),
}));

function holding(game: "pokemon" | "mtg", leg: "export" | "import") {
  return {
    game, item_type: "single", leg, card_id: 1, product_id: null,
    name: game === "pokemon" ? "Charizard" : "Lightning Bolt",
    set_code: game === "pokemon" ? "BASE" : "M11",
    card_number: game === "pokemon" ? "4/102" : "156",
    misc_info: null, variant_label: null, condition_id: 1, psa_grade: 0,
    sealed_condition: null, variant_edition: null, qty_on_hand: game === "pokemon" ? 3 : 4,
    avg_cost_usd: 10, total_cost_usd: game === "pokemon" ? 90 : 40,
  };
}

const HEADER = "Quantity,Name,Set,Card Number,Condition,Printing,Price";
const PRICED = `${HEADER}\n2,Charizard,BASE,4/102,NM,Holofoil,$12.50\n3,Lightning Bolt,M11,156,NM,Normal,$4.25`;

beforeEach(() => {
  localStorage.clear();
  transport.holdings = [holding("pokemon", "export"), holding("mtg", "export")];
  transport.rpc.mockReset().mockResolvedValue({ data: [{ sale_group: 91 }], error: null });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openImporter() {
  await act(async () => {
    render(<LanguageProvider><SalesTab tripId={17} /></LanguageProvider>);
  });
  fireEvent.click(screen.getByRole("button", { name: "Import TCGplayer CSV" }));
  return screen.findByRole("dialog", { name: "Stage a sell lot from a TCGplayer CSV" });
}

async function upload(dialog: HTMLElement, contents: string) {
  const file = new File([contents], "collection.csv", { type: "text/csv" });
  // jsdom lacks File.text; the browser journey uses a native uploaded file.
  Object.defineProperty(file, "text", { value: async () => contents });
  const input = dialog.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  await act(async () => { fireEvent.change(input!, { target: { files: [file] } }); });
}

function field(dialog: HTMLElement, label: string) {
  const container = within(dialog).getByText(label, { selector: "label" }).parentElement!;
  const input = container.querySelector<HTMLInputElement>("input");
  expect(input).not.toBeNull();
  return input!;
}

async function stage(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("button", { name: /^Stage \d+ for review$/ }));
  return screen.findByRole("dialog", { name: /^Sell \d+ items as a lot$/ });
}

describe("Sales CSV import journey", () => {
  it("opens the real importer from the sales button without recording a sale", async () => {
    const importer = await openImporter();
    expect(within(importer).getByRole("button", { name: "Stage 0 for review" }).hasAttribute("disabled")).toBe(true);
    expect(transport.rpc).not.toHaveBeenCalled();
  });

  it.each(["export", "import"] as const)("stages priced export/%s holdings in USD and records only after confirmation", async (secondLeg) => {
    transport.holdings[1] = holding("mtg", secondLeg);
    const importer = await openImporter();
    await upload(importer, PRICED);
    expect(within(importer).getByText("2 matched")).toBeTruthy();
    const sale = await stage(importer);
    expect(transport.rpc).not.toHaveBeenCalled();
    expect(field(sale, "Currency").value).toBe("USD");
    expect(field(sale, "Total proceeds (USD)").value).toBe("37.75");
    expect(within(sale).getByText("Item proceeds total: $37.75")).toBeTruthy();
    fireEvent.change(field(sale, "Shared sale expense (USD)"), { target: { value: "2.25" } });
    fireEvent.change(within(sale).getAllByLabelText("Item expense (USD)")[0], { target: { value: "1.50" } });
    fireEvent.click(within(sale).getByRole("button", { name: "Record sale" }));
    await waitFor(() => expect(transport.rpc).toHaveBeenCalledTimes(1));
    expect(transport.rpc).toHaveBeenCalledWith("record_lot_sale", expect.objectContaining({
      p_orig_currency: null, p_fx_rate: 1, p_gross_total: 37.75,
      p_leg: "export", p_allocation_method: "explicit_prices",
      p_items: [
        expect.objectContaining({ game: "pokemon", card_id: 1, quantity: 2, explicit_gross: 25 }),
        expect.objectContaining({ game: "mtg", card_id: 1, quantity: 3, explicit_gross: 12.75 }),
      ],
      p_sale_expenses: [
        { category: "platform_fee", amount_orig: 2.25, orig_currency: "USD", fx_rate_used: 1 },
        { item_index: 1, category: "shipping", amount_orig: 1.5, orig_currency: "USD", fx_rate_used: 1 },
      ],
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /^Sell \d+ items as a lot$/ })).toBeNull());
  });

  it("merges duplicate rows at their weighted USD price and caps the staged quantity to stock", async () => {
    const importer = await openImporter();
    await upload(importer, `${HEADER}\n2,Charizard,BASE,4/102,NM,Holofoil,$10.00\n3,Charizard,BASE,4/102,NM,Holofoil,$20.00`);
    const sale = await stage(importer);
    expect(field(sale, "Total proceeds (USD)").value).toBe("48.00");
    fireEvent.click(within(sale).getByRole("button", { name: "Record sale" }));
    await waitFor(() => expect(transport.rpc).toHaveBeenCalledTimes(1));
    expect(transport.rpc.mock.calls[0][1]).toMatchObject({
      p_gross_total: 48, p_orig_currency: null, p_fx_rate: 1,
      p_items: [expect.objectContaining({ game: "pokemon", quantity: 3, explicit_gross: 48 })],
    });
  });

  it("requires a choice for ambiguous holdings and excludes unmatched rows", async () => {
    transport.holdings[1] = { ...holding("mtg", "import"), name: "Charizard", card_number: "4/102" };
    const importer = await openImporter();
    await upload(importer, `${HEADER}\n1,Charizard,BASE,4/102,NM,Holofoil,$15.00\n1,Missing,BASE,999,NM,Normal,$99.00`);
    const stageButton = within(importer).getByRole("button", { name: "Stage 0 for review" });
    expect(stageButton.hasAttribute("disabled")).toBe(true);
    const picker = within(importer).getByRole("option", { name: "Select the holding..." }).parentElement!;
    fireEvent.change(picker, { target: { value: "mtg-1-1-0-import" } });
    const sale = await stage(importer);
    expect(field(sale, "Total proceeds (USD)").value).toBe("15.00");
    fireEvent.click(within(sale).getByRole("button", { name: "Record sale" }));
    await waitFor(() => expect(transport.rpc).toHaveBeenCalledTimes(1));
    expect(transport.rpc.mock.calls[0][1]).toMatchObject({
      p_leg: "import", p_gross_total: 15,
      p_items: [expect.objectContaining({ game: "mtg", quantity: 1, explicit_gross: 15 })],
    });
  });

  it("reconciles capped weighted prices to the exact staged cents", async () => {
    transport.holdings = transport.holdings.map((row) => ({ ...row, qty_on_hand: 1 }));
    const importer = await openImporter();
    await upload(importer, `${HEADER}\n2,Charizard,BASE,4/102,NM,Holofoil,$1.00\n1,Charizard,BASE,4/102,NM,Holofoil,$2.00\n2,Lightning Bolt,M11,156,NM,Normal,$1.00\n1,Lightning Bolt,M11,156,NM,Normal,$2.00`);
    const sale = await stage(importer);
    expect(within(sale).getAllByLabelText("Item proceeds").map((input) => (input as HTMLInputElement).value)).toEqual(["1.33", "1.33"]);
    expect(field(sale, "Total proceeds (USD)").value).toBe("2.66");
    fireEvent.change(field(sale, "Shared sale expense (USD)"), { target: { value: "0.25" } });
    fireEvent.click(within(sale).getByRole("button", { name: "Record sale" }));
    await waitFor(() => expect(transport.rpc).toHaveBeenCalledTimes(1));
    expect(transport.rpc.mock.calls[0][1]).toMatchObject({
      p_gross_total: 2.66, p_orig_currency: null, p_fx_rate: 1,
      p_items: [
        expect.objectContaining({ game: "pokemon", quantity: 1, explicit_gross: 1.33 }),
        expect.objectContaining({ game: "mtg", quantity: 1, explicit_gross: 1.33 }),
      ],
      p_sale_expenses: [{ category: "platform_fee", amount_orig: 0.25, orig_currency: "USD", fx_rate_used: 1 }],
    });
  });

  it("keeps unpriced imports on manual allocation with the export currency default", async () => {
    const importer = await openImporter();
    await upload(importer, `${HEADER}\n1,Charizard,BASE,4/102,NM,Holofoil,`);
    const sale = await stage(importer);
    expect(field(sale, "Currency").value).toBe("JPY");
    expect((within(sale).getByRole("option", { name: "Current market value" }) as HTMLOptionElement).selected).toBe(true);
    expect(field(sale, "Proceeds (native)").value).toBe("");
    fireEvent.change(field(sale, "Proceeds (native)"), { target: { value: "2000" } });
    fireEvent.click(within(sale).getByRole("button", { name: "Record sale" }));
    await waitFor(() => expect(transport.rpc).toHaveBeenCalledTimes(1));
    expect(transport.rpc.mock.calls[0][1]).toMatchObject({
      p_orig_currency: "JPY", p_fx_rate: 0.0067, p_gross_total: 2000,
      p_allocation_method: "market_value",
      p_items: [expect.objectContaining({ game: "pokemon", quantity: 1 })],
    });
    expect(transport.rpc.mock.calls[0][1].p_items[0]).not.toHaveProperty("explicit_gross");
  });

  it("cancels a preview without writing and reopens with no previous CSV staged", async () => {
    const importer = await openImporter();
    await upload(importer, PRICED);
    fireEvent.click(within(importer).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Stage a sell lot from a TCGplayer CSV" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Import TCGplayer CSV" }));
    const reopened = await screen.findByRole("dialog", { name: "Stage a sell lot from a TCGplayer CSV" });
    expect(within(reopened).getByRole("button", { name: "Stage 0 for review" }).hasAttribute("disabled")).toBe(true);
    expect(within(reopened).queryByText("2 matched")).toBeNull();
    expect(transport.rpc).not.toHaveBeenCalled();
  });

  it("retains the staged amounts after a rejected save and retries only on another confirmation", async () => {
    transport.rpc.mockResolvedValueOnce({ data: null, error: { message: "fixture rejection" } });
    const importer = await openImporter();
    await upload(importer, PRICED);
    const sale = await stage(importer);
    fireEvent.click(within(sale).getByRole("button", { name: "Record sale" }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith("fixture rejection"));
    expect(transport.rpc).toHaveBeenCalledTimes(1);
    expect(field(sale, "Total proceeds (USD)").value).toBe("37.75");
    const firstPayload = transport.rpc.mock.calls[0][1];
    await waitFor(() => expect(within(sale).getByRole("button", { name: "Record sale" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(within(sale).getByRole("button", { name: "Record sale" }));
    await waitFor(() => expect(transport.rpc).toHaveBeenCalledTimes(2));
    expect(transport.rpc.mock.calls[1]).toEqual(["record_lot_sale", firstPayload]);
  });
});
