// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "./LanguageContext";

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  insert: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mocks.client,
}));

import InventoryListingPanel, {
  buildSealedListingInsert,
  fetchSealedListingData,
  type ListingPlatform,
  type SealedListingExposure,
  type SealedListingHolding,
} from "./InventoryListingPanel";

afterEach(cleanup);

const holding: SealedListingHolding = {
  game: "pokemon_sealed",
  item_type: "sealed",
  leg: "import",
  product_id: 42,
  name: "Pokémon 151 Booster Box",
  set_code: "SV2A",
  sealed_condition: "no_shrink",
  variant_edition: "1ed",
  qty_on_hand: 3,
};

const platform: ListingPlatform = {
  platform: "tcgplayer",
  market_region: "NA",
  fulfillment_leg: "import",
  is_active: true,
};

const exposure: SealedListingExposure = {
  listing_id: 7,
  platform: "tcgplayer",
  external_listing_id: "sealed-42",
  status: "active",
  leg: "import",
  game: "pokemon_sealed",
  product_id: 42,
  item_name: "Pokémon 151 Booster Box",
  set_code: "SV2A",
  sealed_condition: "no_shrink",
  variant_edition: "1ed",
  quantity_listed: 3,
  qty_on_hand: 1,
  over_promised: 2,
  last_pushed_quantity: 3,
  desired_quantity: 1,
  needs_push: true,
  can_push: true,
  ask_price_usd: 199.5,
  listed_at: "2026-10-01",
  market_region: "NA",
};

function pagedClient(
  rows: Record<string, unknown[]>,
  errors: Partial<Record<string, string>> = {},
) {
  const ranges: Record<string, Array<[number, number]>> = {};
  const orders: Record<string, string[][]> = {};
  const from = vi.fn((table: string) => ({
    select: vi.fn(() => {
      const pageOrders: string[] = [];
      const builder = {
        eq: vi.fn(() => builder),
        order: vi.fn((column: string) => {
          pageOrders.push(column);
          return builder;
        }),
        range: vi.fn(async (start: number, end: number) => {
          ranges[table] = [...(ranges[table] ?? []), [start, end]];
          orders[table] = [...(orders[table] ?? []), [...pageOrders]];
          return errors[table]
            ? { data: null, error: { message: errors[table] } }
            : { data: (rows[table] ?? []).slice(start, end + 1), error: null };
        }),
      };
      return builder;
    }),
    insert: mocks.insert,
  }));
  return { client: { from }, ranges, orders };
}

beforeEach(() => {
  mocks.insert.mockReset().mockResolvedValue({ error: null });
  mocks.client = pagedClient({
    inventory_holdings_v: [holding],
    inventory_listing_platforms: [platform],
    inventory_listing_exposure_v: [],
  }).client;
});

describe("sealed inventory listing contract", () => {
  it("builds a sealed identity and keeps market geography separate from its fulfillment leg", () => {
    expect(buildSealedListingInsert(holding, platform, 2, 149.99, " listing-7 ")).toEqual({
      platform: "tcgplayer",
      external_listing_id: "listing-7",
      game: "pokemon_sealed",
      item_type: "sealed",
      card_id: null,
      product_id: 42,
      condition_id: null,
      psa_grade: 0,
      sealed_condition: "no_shrink",
      variant_edition: "1ed",
      leg: "import",
      quantity_listed: 2,
      ask_price_usd: 149.99,
      status: "active",
    });

    expect(buildSealedListingInsert(holding, platform, 1, null, "")).toMatchObject({
      external_listing_id: null,
      status: "draft",
    });

    expect(() => buildSealedListingInsert(
      holding,
      { ...platform, market_region: "JP", fulfillment_leg: "export" },
      1,
      null,
      "",
    )).toThrow("cannot fulfill this inventory leg");
  });

  it("pages sealed holdings beyond the PostgREST cap with a total order", async () => {
    const holdings = Array.from({ length: 1205 }, (_, index) => ({
      ...holding,
      product_id: index + 1,
      name: `Sealed product ${index + 1}`,
    }));
    const fixture = pagedClient({
      inventory_holdings_v: holdings,
      inventory_listing_platforms: [platform],
      inventory_listing_exposure_v: [],
    });

    const result = await fetchSealedListingData(fixture.client as never);

    expect(result.holdings).toHaveLength(1205);
    expect(fixture.ranges.inventory_holdings_v).toEqual([
      [0, 999],
      [1000, 1999],
      [1205, 2204],
    ]);
    expect(fixture.orders.inventory_holdings_v[0]).toEqual([
      "product_id",
      "leg",
      "sealed_condition",
      "variant_edition",
    ]);
  });

  it("surfaces a listing read failure instead of rendering empty tables", async () => {
    mocks.client = pagedClient(
      {
        inventory_holdings_v: [holding],
        inventory_listing_platforms: [platform],
        inventory_listing_exposure_v: [],
      },
      { inventory_listing_exposure_v: "listing exposure unavailable" },
    ).client;

    render(<LanguageProvider><InventoryListingPanel /></LanguageProvider>);

    expect((await screen.findByRole("alert")).textContent).toContain("listing exposure unavailable");
    expect(screen.queryByText("No sealed listings are active.")).toBeNull();
  });

  it("identifies each listing and explains automatic or manual quantity reconciliation", async () => {
    mocks.client = pagedClient({
      inventory_holdings_v: [],
      inventory_listing_platforms: [platform],
      inventory_listing_exposure_v: [
        exposure,
        {
          ...exposure,
          listing_id: 8,
          platform: "manual-market",
          external_listing_id: null,
          can_push: false,
        },
      ],
    }).client;

    render(<LanguageProvider><InventoryListingPanel /></LanguageProvider>);

    expect(await screen.findAllByText("Pokémon 151 Booster Box")).toHaveLength(2);
    expect(screen.getAllByText(/SV2A · Product #42 · No Shrink · 1st Edition/)).toHaveLength(2);
    expect(screen.getAllByText("Oversold by 2")).toHaveLength(2);
    expect(screen.getByText("Automatic sync: change quantity from 3 to 1.")).toBeTruthy();
    expect(screen.getByText("Manual update required: change quantity from 3 to 1.")).toBeTruthy();
  });

  it("records a sealed listing through the operator dialog", async () => {
    render(<LanguageProvider><InventoryListingPanel /></LanguageProvider>);
    await screen.findByText("Pokémon 151 Booster Box");

    fireEvent.click(screen.getByRole("button", { name: "List sealed item" }));
    expect((screen.getByLabelText("Platform") as HTMLSelectElement).value).toBe("tcgplayer");
    fireEvent.change(screen.getByLabelText("Ask price (USD)"), { target: { value: "199.50" } });
    fireEvent.change(screen.getByLabelText("Platform listing ID (optional)"), { target: { value: "sealed-42" } });
    fireEvent.click(screen.getByRole("button", { name: "Record listing" }));

    await waitFor(() => expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      game: "pokemon_sealed",
      item_type: "sealed",
      product_id: 42,
      card_id: null,
      condition_id: null,
      psa_grade: 0,
      leg: "import",
      platform: "tcgplayer",
      ask_price_usd: 199.5,
      external_listing_id: "sealed-42",
    })));
  });

  it("surfaces an insert failure and keeps the listing dialog open", async () => {
    mocks.insert.mockResolvedValueOnce({ error: { message: "listing insert denied" } });
    render(<LanguageProvider><InventoryListingPanel /></LanguageProvider>);
    await screen.findByText("Pokémon 151 Booster Box");
    fireEvent.click(screen.getByRole("button", { name: "List sealed item" }));

    fireEvent.click(screen.getByRole("button", { name: "Record listing" }));

    expect((await screen.findByRole("alert")).textContent).toContain("listing insert denied");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mocks.insert).toHaveBeenCalledOnce();
  });
});
