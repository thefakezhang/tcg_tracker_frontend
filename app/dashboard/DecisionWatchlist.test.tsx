// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DecisionWatchlist from "./DecisionWatchlist";
import { selectAll } from "@/lib/supabase/select-all";

const rpc = vi.fn();

vi.mock("@/lib/i18n", () => ({
  useTranslation: () => ({ t: (key: string, params?: { count?: number; value?: string }) => params?.count ?? params?.value ?? key }),
}));
vi.mock("./LanguageContext", () => ({ useLanguage: () => ({ language: "en" }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: vi.fn(), rpc }) }));
vi.mock("@/lib/supabase/select-all", () => ({ selectAll: vi.fn() }));
// The watchlist enrichment (owned counts, market ROI rows, tap-to-detail modal)
// is out of scope for this unit test - stub the data hooks and the modal so the
// component renders without a Supabase client chain or GameProvider.
vi.mock("./owned-inventory", () => ({
  useOwnedInventoryCounts: () => new Map(),
  ownedInventoryKey: (i: { game: string; cardId?: number | string | null }) => `${i.game}:${i.cardId ?? ""}`,
}));
vi.mock("./use-card-data", () => ({
  fetchCardRowsByIds: vi.fn(async () => new Map()),
  fetchCardRowById: vi.fn(async () => null),
}));
vi.mock("./CardDetailModal", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function watchRow(over: Record<string, unknown> = {}) {
  return {
    rule_id: 1, card_id: 42, psa_grade: 10, decided_at: "2026-07-20T10:00:00Z",
    flagged_price: 1000, flagged_currency: "JPY", current_price: 1100,
    current_currency: "JPY", current_observed_on: "2026-07-20", reason: null,
    regional_name: "テスト", english_name: "Test Card", set_code: "M6",
    card_number: "001", image_url: null, store_sightings: [],
    trip_id: null, trip_name: null, trip_status: null, ...over,
  };
}

// A watch is tagged with the trip that was underway the day it was made
// (record_deal_decision), and backend 000520 exposes that on the view. The
// filter defaults to ALL trips, not the current one: when this shipped, 27 of
// 29 active watches carried no trip at all - made while nothing was underway -
// so defaulting to a trip would have hidden nearly the whole list.
describe("DecisionWatchlist trip scope", () => {
  it("shows every trip's watches by default", async () => {
    vi.mocked(selectAll).mockResolvedValue([
      watchRow({ rule_id: 1, english_name: "On Trip Five", trip_id: 5, trip_name: "Trip 5", trip_status: "active" }),
      watchRow({ rule_id: 2, card_id: 43, english_name: "No Trip At All" }),
    ]);
    render(<DecisionWatchlist />);
    await waitFor(() => expect(screen.getByText("On Trip Five")).toBeTruthy());
    expect(screen.getByText("No Trip At All")).toBeTruthy();
  });

  it("narrows to one trip, and can isolate the untagged ones", async () => {
    vi.mocked(selectAll).mockResolvedValue([
      watchRow({ rule_id: 1, english_name: "On Trip Five", trip_id: 5, trip_name: "Trip 5", trip_status: "active" }),
      watchRow({ rule_id: 2, card_id: 43, english_name: "No Trip At All" }),
    ]);
    render(<DecisionWatchlist />);
    await waitFor(() => expect(screen.getByText("On Trip Five")).toBeTruthy());

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "5" } });
    await waitFor(() => expect(screen.queryByText("No Trip At All")).toBeNull());
    expect(screen.getByText("On Trip Five")).toBeTruthy();

    fireEvent.change(select, { target: { value: "none" } });
    await waitFor(() => expect(screen.queryByText("On Trip Five")).toBeNull());
    expect(screen.getByText("No Trip At All")).toBeTruthy();
  });

  it("offers no trip control when nothing is tagged and nothing is untagged", async () => {
    vi.mocked(selectAll).mockResolvedValue([]);
    render(<DecisionWatchlist />);
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  });
});

describe("DecisionWatchlist", () => {
  it("shows all store sightings with the normalized cheapest option first", async () => {
    vi.mocked(selectAll).mockResolvedValue([{
      rule_id: 1,
      card_id: 42,
      psa_grade: 10,
      decided_at: "2026-07-20T10:00:00Z",
      flagged_price: 1000,
      flagged_currency: "JPY",
      current_price: 1100,
      current_currency: "JPY",
      current_observed_on: "2026-07-20",
      reason: null,
      regional_name: "テスト",
      english_name: "Test Card",
      set_code: "M6",
      card_number: "001",
      image_url: null,
      store_sightings: [
        { sighting_id: 1, store_name: "Store A", observed_price: 1000, currency: "JPY", fx_rate_to_usd: 0.0065, price_usd: 6.5, observed_at: "2026-07-20T10:00:00Z", note: null },
        { sighting_id: 2, store_name: "Store B", observed_price: 8, currency: "USD", fx_rate_to_usd: 1, price_usd: 8, observed_at: "2026-07-20T11:00:00Z", note: "Second stop" },
      ],
    }]);

    render(<DecisionWatchlist />);

    await waitFor(() => expect(screen.getByText("Store A")).toBeTruthy());
    expect(screen.getByText("Store B")).toBeTruthy();
    expect(screen.getByText("decision.cheapest")).toBeTruthy();
    expect(screen.getByText("$6.50")).toBeTruthy();
  });

  it("unwatches a card and removes it from the active list", async () => {
    vi.mocked(selectAll).mockResolvedValue([{
      rule_id: 7,
      card_id: 42,
      psa_grade: 10,
      decided_at: "2026-07-20T10:00:00Z",
      flagged_price: 1000,
      flagged_currency: "JPY",
      current_price: 1100,
      current_currency: "JPY",
      current_observed_on: "2026-07-20",
      reason: null,
      regional_name: "テスト",
      english_name: "Test Card",
      set_code: "M6",
      card_number: "001",
      image_url: null,
      store_sightings: [],
    }]);
    rpc.mockResolvedValue({ error: null });

    render(<DecisionWatchlist />);

    fireEvent.click(await screen.findByRole("button", { name: "decision.unwatch" }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("deactivate_deal_watch", { p_rule_id: 7 }));
    expect(screen.getByText("decision.emptyWatchlist")).toBeTruthy();
  });
});
