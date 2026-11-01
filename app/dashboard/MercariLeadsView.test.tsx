// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "./LanguageContext";
import MercariLeadsView, {
  DEFAULT_LEAD_FILTERS,
  MercariLeadsRequestError,
  parseMercariLeads,
  type MercariLead,
  type MercariLeadCursor,
  type MercariLeadFilters,
  type MercariLeadsPage,
} from "./MercariLeadsView";
import MercariTab from "./MercariTab";
import type { MercariDealsPage } from "./MercariDealsView";

// A priced modern raw lead with a multiple, the shape most leads take.
const RAW: MercariLead = {
  external_item_id: "m12345678901",
  source_item_type: "mercari",
  canonical_url: "https://jp.mercari.com/item/m12345678901",
  sanitized_title: "ポケモンカード151 リザードンex 006/165 美品",
  ask_jpy: 6000,
  shipping_payer: "seller",
  buyer_pays_shipping: false,
  shipping_added_jpy: 0,
  seller_condition_id: "2",
  source_status: "ON_SALE",
  source_created_at: "2026-10-27T22:00:00+00:00",
  first_seen_at: "2026-10-28T00:30:00+00:00",
  observed_at: "2026-10-28T01:15:00+00:00",
  listing_age_hours: 75.5,
  observed_age_hours: 70.2,
  holder_hint: "holder_unknown",
  title_psa_grade: null,
  card_resolution: "uid",
  regional_name: "リザードンex",
  english_name: "Charizard ex",
  set_code: "SV2a",
  set_name: "Pokemon Card 151",
  card_number: "006/165",
  misc_info: "UNKNOWN",
  edition: "not_applicable",
  foil_treatment: "normal",
  image_url: "https://images.example.test/charizard.png",
  match_tier: "identity",
  title_card_in_photo_scope: true,
  lane: "modern_raw",
  value_usd: 120,
  value_condition: "nm",
  nm_value_usd: 120,
  value_psa_grade: 0,
  value_basis: "ebay_rule_v0",
  value_as_of: "2026-10-28",
  value_sample_count: 12,
  value_window_days: 60,
  unpriced_reason: null,
  landed_ask_usd: 39.6,
  selling_cost_usd: 21.9,
  net_value_usd: 98.1,
  multiple: 2.477,
  multiple_withheld_reason: null,
  other_listings: 0,
  photo_check_state: "unchecked",
  photo_source_card_uid: null,
  photo_card_uid: null,
  photo_regional_name: null,
  photo_english_name: null,
  photo_set_code: null,
  photo_card_number: null,
  photo_image_url: null,
  photo_psa_grade: null,
  photo_checked_at: null,
  latest_lead_action: null,
  latest_lead_action_reason: null,
  latest_lead_action_at: null,
  dismissed: false,
  photo_check_requested: false,
};

const PSA10: MercariLead = {
  ...RAW,
  external_item_id: "m22222222222",
  canonical_url: "https://jp.mercari.com/item/m22222222222",
  sanitized_title: "リザードンex SAR PSA10",
  ask_jpy: 30000,
  holder_hint: "psa_10",
  title_psa_grade: 10,
  lane: "psa",
  value_usd: 480,
  value_condition: null,
  nm_value_usd: null,
  value_psa_grade: 10,
  value_sample_count: 7,
  value_window_days: 180,
  landed_ask_usd: 198,
  selling_cost_usd: 80.2,
  net_value_usd: 399.8,
  multiple: 2.019,
};

const UNREAD_PSA: MercariLead = {
  ...PSA10,
  external_item_id: "m33333333333",
  canonical_url: "https://jp.mercari.com/item/m33333333333",
  sanitized_title: "リザードンex PSA 鑑定品",
  holder_hint: "psa_unknown",
  title_psa_grade: null,
  value_usd: null,
  value_psa_grade: null,
  value_as_of: null,
  value_sample_count: 0,
  value_window_days: null,
  selling_cost_usd: null,
  net_value_usd: null,
  multiple: null,
  multiple_withheld_reason: "psa_grade_unread",
};

// A vintage card the seller rates 3-6, priced as damaged at P25 of the same
// raw sales, with its Near Mint value kept beside it (backend 000617).
const DAMAGED_VINTAGE: MercariLead = {
  ...RAW,
  external_item_id: "m66666666666",
  canonical_url: "https://jp.mercari.com/item/m66666666666",
  sanitized_title: "リザードン 006/087 neo 1ED 傷あり",
  set_code: "neo4",
  set_name: "Neo Destiny",
  card_number: "006/087",
  edition: "first",
  foil_treatment: "mirror",
  match_tier: "exact",
  lane: "vintage_raw",
  seller_condition_id: "5",
  ask_jpy: 4000,
  landed_ask_usd: 26.4,
  value_usd: 45,
  value_condition: "damaged_p25",
  nm_value_usd: 120,
  selling_cost_usd: 8.6,
  net_value_usd: 36.4,
  multiple: 1.379,
};

const UNPRICED: MercariLead = {
  ...RAW,
  external_item_id: "ABCDEFGHIJKLMNOPQRSTUV",
  source_item_type: "beyond",
  canonical_url: "https://jp.mercari.com/shops/product/ABCDEFGHIJKLMNOPQRSTUV",
  sanitized_title: "ピカチュウ プロモ まとめ",
  lane: "unpriced",
  value_usd: null,
  value_condition: null,
  nm_value_usd: null,
  value_psa_grade: null,
  value_as_of: null,
  value_sample_count: 2,
  value_window_days: null,
  unpriced_reason: "thin_raw_comps_180d",
  selling_cost_usd: null,
  net_value_usd: null,
  multiple: null,
  other_listings: 3,
};

function page(leads: MercariLead[], nextCursor: MercariLeadCursor | null = null): MercariLeadsPage {
  return { leads, nextCursor };
}

type Loader = (filters: MercariLeadFilters, cursor: MercariLeadCursor | null) => Promise<MercariLeadsPage>;
type Actor = (id: string, action: "dismissed" | "photo_check_requested", reason: string) => Promise<void>;

function view(loader: Loader, actor: Actor = async () => {}) {
  return render(
    <LanguageProvider>
      <MercariLeadsView loader={loader} actor={actor} />
    </LanguageProvider>,
  );
}

async function onlyCard() {
  const cards = await screen.findAllByTestId("mercari-lead-card");
  expect(cards).toHaveLength(1);
  return cards[0];
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("MercariLeadsView", () => {
  it("asks for one lane by best multiple with unavailable, rejected and dismissed leads hidden", async () => {
    let resolve!: (leads: MercariLead[]) => void;
    const loader = vi.fn(() => new Promise<MercariLeadsPage>((done) => {
      resolve = (leads) => done(page(leads));
    }));
    view(loader);

    expect(screen.getByRole("status").textContent).toContain("Loading Mercari leads");
    await act(async () => resolve([]));
    expect(await screen.findByText("No leads in this lane")).toBeTruthy();
    expect(DEFAULT_LEAD_FILTERS).toEqual({
      lane: "modern_raw",
      sort: "multiple",
      photo: "",
      includeDismissed: false,
      includeUnavailable: false,
    });
    expect(loader).toHaveBeenCalledWith(DEFAULT_LEAD_FILTERS, null);
  });

  it("shows the title link, age, photo badge, ask, condition, card, value evidence and multiple", async () => {
    view(vi.fn(async () => page([RAW])));

    const card = await onlyCard();
    const title = within(card).getByRole("link", { name: RAW.sanitized_title });
    expect(title.getAttribute("href")).toBe(RAW.canonical_url);
    expect(title.getAttribute("target")).toBe("_blank");
    const age = within(card).getByTestId("mercari-lead-age");
    expect(age.textContent).toBe("Listed 3\u00a0d ago");
    expect(age.className).toContain("text-red-800");
    expect(within(card).getByText("Last seen (JST): Oct 28, 2026, 10:15 AM (2 d ago)")).toBeTruthy();
    expect(within(card).getByTestId("mercari-lead-photo").textContent).toBe("Not photo-checked");
    expect(within(card).getByText("Raw")).toBeTruthy();
    expect(within(card).getByText("¥6,000 · $39.60 landed")).toBeTruthy();
    expect(within(card).queryByText("Buyer pays shipping")).toBeNull();
    expect(within(card).getByText("未使用に近い (close to unused)")).toBeTruthy();
    expect(card.textContent).toContain("Pokemon Card 151 (SV2a) 006/165");
    expect(card.textContent).not.toContain("UNKNOWN");
    // A plain modern print has no edition or finish to name.
    expect(card.textContent).not.toContain("Pokemon Card 151 (SV2a) 006/165 ·");
    expect(within(card).getByTestId("mercari-lead-match").textContent).toBe("Title match: set and number");
    expect(within(card).queryByTestId("mercari-lead-nm-value")).toBeNull();
    expect(within(card).queryByTestId("mercari-lead-photo-scope")).toBeNull();
    expect(card.textContent).toContain("$120.00 · Provisional eBay value, from raw sales");
    expect(within(card).getByTestId("mercari-lead-evidence").textContent).toBe("12 sales in the last 60 days, newest Oct\u00a028,\u00a02026");
    expect(within(card).getByText("Net $98.10 after $21.90 of eBay fees and postage")).toBeTruthy();
    expect(within(card).getByTestId("mercari-lead-multiple").textContent).toContain("2.48x");
    const image = within(card).getByRole("img", { name: "Catalog image of リザードンex (SV2a 006/165)" });
    expect(image.getAttribute("src")).toContain("/api/proxy-image?url=");
    expect(document.body.textContent).toContain("Nothing here is a completed sale");
  });

  it("names the age by first sighting when the listing has no creation time", async () => {
    view(vi.fn(async () => page([{ ...RAW, source_created_at: null, listing_age_hours: 5.9 }])));

    const age = within(await onlyCard()).getByTestId("mercari-lead-age");
    expect(age.textContent).toBe("First seen 5\u00a0h ago");
    expect(age.className).toContain("text-emerald-800");
  });

  it("switches one lane at a time, writes it to the URL, and resets paging", async () => {
    const loader = vi.fn(async (filters: MercariLeadFilters) => page(filters.lane === "psa" ? [PSA10] : [RAW]));
    view(loader);

    await onlyCard();
    const lanes = screen.getByRole("group", { name: "Lane" });
    expect(within(lanes).getByRole("button", { name: "Modern raw" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(lanes).getByRole("button", { name: "PSA" }));

    await waitFor(() => expect(screen.getByText(PSA10.sanitized_title)).toBeTruthy());
    expect(loader).toHaveBeenLastCalledWith({ ...DEFAULT_LEAD_FILTERS, lane: "psa" }, null);
    expect(window.location.search).toBe("?lane=psa");
    expect(within(lanes).getByRole("button", { name: "PSA" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText(RAW.sanitized_title)).toBeNull();
    for (const [filters] of loader.mock.calls) {
      expect(["modern_raw", "psa"]).toContain(filters.lane);
    }
  });

  it("reads the lane and sort from the URL and sorts newest on request", async () => {
    window.history.replaceState(null, "", "/dashboard?view=mercari&lane=vintage_raw&sort=newest");
    const loader = vi.fn(async () => page([]));
    view(loader);

    expect(await screen.findByText("No leads in this lane")).toBeTruthy();
    expect(loader).toHaveBeenCalledWith({ ...DEFAULT_LEAD_FILTERS, lane: "vintage_raw", sort: "newest" }, null);
    const sorts = screen.getByRole("group", { name: "Sort" });
    expect(within(sorts).getByRole("button", { name: "Newest" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(sorts).getByRole("button", { name: "Best multiple" }));
    await waitFor(() => expect(loader).toHaveBeenLastCalledWith({ ...DEFAULT_LEAD_FILTERS, lane: "vintage_raw" }, null));
    expect(window.location.search).toBe("?view=mercari&lane=vintage_raw");
  });

  it("shows the unpriced lane newest first, with the reason and the other listings it stands for", async () => {
    const loader = vi.fn(async (filters: MercariLeadFilters) => page(filters.lane === "unpriced" ? [UNPRICED] : []));
    view(loader);

    expect(await screen.findByText("No leads in this lane")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Unpriced" }));

    const card = await onlyCard();
    // Unpriced leads carry no multiple, so "Best multiple" is not offered there.
    expect(loader).toHaveBeenLastCalledWith({ ...DEFAULT_LEAD_FILTERS, lane: "unpriced", sort: "newest" }, null);
    expect(screen.getByRole("button", { name: "Best multiple" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Newest" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("mercari-lane-hint").textContent).toContain("shown newest first");
    const evidence = within(card).getByTestId("mercari-lead-multiple");
    expect(evidence.textContent).toContain("Unpriced: fewer than 3 raw eBay sales in the last 180 days (2 found)");
    expect(evidence.textContent).toContain("+3 other listings");
    expect(evidence.textContent).not.toMatch(/\dx/);
    expect(within(card).getByText("No value yet")).toBeTruthy();
    expect(within(card).queryByTestId("mercari-lead-evidence")).toBeNull();
    expect(within(card).getByRole("link", { name: UNPRICED.sanitized_title }).getAttribute("href"))
      .toBe("https://jp.mercari.com/shops/product/ABCDEFGHIJKLMNOPQRSTUV");
  });

  it("names a PSA unpriced reason at the title's grade", async () => {
    view(vi.fn(async () => page([{
      ...UNPRICED,
      holder_hint: "psa_9",
      title_psa_grade: 9,
      unpriced_reason: "no_psa_comps_at_grade_180d",
      value_sample_count: 0,
      other_listings: 0,
    }])));

    const card = await onlyCard();
    expect(within(card).getByText("PSA 9")).toBeTruthy();
    expect(within(card).getByTestId("mercari-lead-multiple").textContent)
      .toBe("Unpriced: no PSA 9 eBay sales in the last 180 days");
  });

  it("values a PSA lead only at its exact grade and never as raw", async () => {
    view(vi.fn(async () => page([PSA10])));

    const card = await onlyCard();
    expect(within(card).getByText("PSA 10")).toBeTruthy();
    expect(card.textContent).toContain("$480.00 · Provisional eBay value, at PSA 10");
    expect(card.textContent).not.toContain("from raw sales");
    expect(within(card).queryByText("Raw")).toBeNull();
    expect(within(card).getByTestId("mercari-lead-evidence").textContent).toBe("7 sales in the last 180 days, newest Oct\u00a028,\u00a02026");
    expect(within(card).getByTestId("mercari-lead-multiple").textContent).toContain("2.02x");
  });

  it("shows a PSA lead whose grade the title does not say with no value and the reason", async () => {
    view(vi.fn(async () => page([UNREAD_PSA])));

    const card = await onlyCard();
    expect(within(card).getByText("PSA, grade not read")).toBeTruthy();
    expect(within(card).getByText("No value without the exact PSA grade")).toBeTruthy();
    expect(within(card).getByTestId("mercari-lead-multiple").textContent)
      .toBe("No multiple: the title does not say the PSA grade, and a PSA value needs the exact grade.");
    expect(card.textContent).not.toContain("$480.00");
  });

  it("shows a modern card rated 3 to 6 at its Near Mint value as evidence, with why the multiple is withheld", async () => {
    view(vi.fn(async () => page([{
      ...RAW,
      seller_condition_id: "4",
      multiple: null,
      multiple_withheld_reason: "seller_condition_3_6",
    }])));

    const card = await onlyCard();
    expect(within(card).getByText("やや傷や汚れあり (some damage or dirt)")).toBeTruthy();
    expect(card.textContent).toContain("$120.00 · Provisional eBay value, from raw sales");
    expect(within(card).getByTestId("mercari-lead-evidence").textContent).toBe("12 sales in the last 60 days, newest Oct\u00a028,\u00a02026");
    const multiple = within(card).getByTestId("mercari-lead-multiple");
    expect(multiple.textContent).toBe("No multiple: the seller rates this modern card 3 to 6, so its Near Mint value is shown as evidence only.");
    expect(within(card).queryByTestId("mercari-lead-nm-value")).toBeNull();
  });

  it("gives each photo-check state its own badge and shows the photo's card on a conflict", async () => {
    const states: Array<[MercariLead["photo_check_state"], string, string]> = [
      ["unchecked", "Not photo-checked", "amber"],
      ["confirmed", "Photo-checked", "emerald"],
      ["conflict", "Photo disagrees with title", "red"],
      ["inconclusive", "Photo inconclusive", "zinc"],
    ];
    const leads = states.map(([state], index) => ({
      ...RAW,
      external_item_id: `m4444444444${index}`,
      canonical_url: `https://jp.mercari.com/item/m4444444444${index}`,
      photo_check_state: state,
      ...(state === "unchecked" ? {} : {
        photo_source_card_uid: "6f3c0a0e-7d8e-4f5e-9a0b-1c2d3e4f5a6b",
        photo_checked_at: "2026-10-30T03:00:00+00:00",
      }),
      ...(state === "conflict" ? {
        photo_card_uid: "6f3c0a0e-7d8e-4f5e-9a0b-1c2d3e4f5a6b",
        photo_regional_name: "リザードン",
        photo_english_name: "Charizard",
        photo_set_code: "SV3a",
        photo_card_number: "UNKNOWN",
        photo_image_url: "https://images.example.test/other.png",
        photo_psa_grade: 9,
      } : {}),
    }));
    view(vi.fn(async () => page(leads)));

    const cards = await screen.findAllByTestId("mercari-lead-card");
    expect(cards).toHaveLength(4);
    states.forEach(([, label, tone], index) => {
      const badge = within(cards[index]).getByTestId("mercari-lead-photo");
      expect(badge.textContent).toBe(label);
      expect(badge.className).toContain(tone);
    });
    const photoCard = within(cards[2]).getByTestId("mercari-lead-photo-card");
    expect(photoCard.textContent).toContain("The photo check found");
    expect(photoCard.textContent).toContain("リザードン · Charizard · SV3a · PSA 9");
    expect(photoCard.textContent).not.toContain("UNKNOWN");
    expect(within(photoCard).getByRole("img").getAttribute("src")).toContain(encodeURIComponent("https://images.example.test/other.png"));
    for (const index of [0, 1, 3]) {
      expect(within(cards[index]).queryByTestId("mercari-lead-photo-card")).toBeNull();
    }
    expect(within(cards[1]).getByText("Photo checked (JST): Oct 30, 2026, 12:00 PM")).toBeTruthy();
    // A confirmed photo needs no second check.
    expect(within(cards[1]).queryByRole("button", { name: "Request photo check" })).toBeNull();
    expect(within(cards[0]).getByRole("button", { name: "Request photo check" })).toBeTruthy();
  });

  it("says when the photo matched a card the cloud catalog does not hold", async () => {
    view(vi.fn(async () => page([{
      ...RAW,
      photo_check_state: "conflict",
      photo_source_card_uid: "6f3c0a0e-7d8e-4f5e-9a0b-1c2d3e4f5a6b",
      photo_checked_at: "2026-10-30T03:00:00+00:00",
    }])));

    const photoCard = within(await onlyCard()).getByTestId("mercari-lead-photo-card");
    expect(photoCard.textContent).toContain("a card that is not in the cloud catalog");
  });

  it("prices a vintage card rated 3 to 6 as damaged, with a multiple and its Near Mint value beside it", async () => {
    view(vi.fn(async () => page([DAMAGED_VINTAGE])));

    const card = await onlyCard();
    expect(within(card).getByText("傷や汚れあり (damage or dirt)")).toBeTruthy();
    const multiple = within(card).getByTestId("mercari-lead-multiple");
    expect(multiple.textContent).toContain("1.38x");
    expect(multiple.textContent).toContain("net value over the landed ask, priced as damaged");
    expect(card.textContent).toContain("$45.00 · Provisional eBay value, priced as damaged (bottom quarter of raw sales)");
    expect(within(card).getByTestId("mercari-lead-nm-value").textContent).toBe("Near Mint $120.00");
    expect(card.textContent).not.toContain("from raw sales");
  });

  it("labels the card with its edition and finish from the typed axes, and names the match tier", async () => {
    view(vi.fn(async () => page([DAMAGED_VINTAGE, { ...RAW, match_tier: "a_future_tier" }])));

    const [vintage, modern] = await screen.findAllByTestId("mercari-lead-card");
    expect(vintage.textContent).toContain("Neo Destiny (neo4) 006/087 · ミラー,1ED");
    expect(within(vintage).getByTestId("mercari-lead-match").textContent)
      .toBe("Title match: name, set and number, printing named");
    // A tier the matcher adds later is shown by its code rather than refused.
    expect(within(modern).getByTestId("mercari-lead-match").textContent).toBe("Title match: a_future_tier");
  });

  it("shows a thin PSA value as evidence, at its grade, with the sale count", async () => {
    view(vi.fn(async () => page([
      { ...PSA10, value_sample_count: 2, multiple: null, multiple_withheld_reason: "psa_thin_comps" },
      {
        ...PSA10,
        external_item_id: "m77777777777",
        canonical_url: "https://jp.mercari.com/item/m77777777777",
        holder_hint: "psa_9",
        title_psa_grade: 9,
        value_psa_grade: 9,
        value_sample_count: 1,
        multiple: null,
        multiple_withheld_reason: "psa_thin_comps",
      },
    ])));

    const [two, one] = await screen.findAllByTestId("mercari-lead-card");
    expect(within(two).getByTestId("mercari-lead-multiple").textContent)
      .toBe("Only 2 PSA 10 sales; shown as evidence, with no multiple.");
    expect(two.textContent).toContain("$480.00 · Provisional eBay value, at PSA 10");
    expect(within(two).getByTestId("mercari-lead-evidence").textContent).toBe("2 sales in the last 180 days, newest Oct\u00a028,\u00a02026");
    expect(within(one).getByTestId("mercari-lead-multiple").textContent)
      .toBe("Only 1 PSA 9 sale; shown as evidence, with no multiple.");
    expect(one.textContent).toContain("at PSA 9");
  });

  it("says when the photo check cannot confirm the title's card, and offers no photo check", async () => {
    view(vi.fn(async () => page([
      { ...RAW, title_card_in_photo_scope: false },
      {
        ...RAW,
        external_item_id: "m88888888888",
        canonical_url: "https://jp.mercari.com/item/m88888888888",
        title_card_in_photo_scope: false,
        photo_check_state: "conflict",
        photo_source_card_uid: "6f3c0a0e-7d8e-4f5e-9a0b-1c2d3e4f5a6b",
        photo_checked_at: "2026-10-30T03:00:00+00:00",
      },
    ])));

    const [unchecked, conflict] = await screen.findAllByTestId("mercari-lead-card");
    const badge = within(unchecked).getByTestId("mercari-lead-photo");
    expect(badge.textContent).toBe("Photo check can't confirm this card");
    expect(badge.className).toContain("zinc");
    expect(badge.className).not.toContain("amber");
    expect(within(unchecked).getByTestId("mercari-lead-photo-scope").textContent)
      .toBe("The photo check compares this listing with other cards, so it cannot confirm the card the title names yet.");
    expect(within(unchecked).queryByRole("button", { name: "Request photo check" })).toBeNull();
    expect(within(unchecked).getByRole("button", { name: "Dismiss" })).toBeTruthy();
    // A result the check did reach keeps its own badge, with the same caveat.
    expect(within(conflict).getByTestId("mercari-lead-photo").textContent).toBe("Photo disagrees with title");
    expect(within(conflict).getByTestId("mercari-lead-photo-scope")).toBeTruthy();
  });

  it("marks buyer-paid shipping and the shipping added to the landed ask", async () => {
    view(vi.fn(async () => page([{
      ...RAW,
      shipping_payer: "buyer",
      buyer_pays_shipping: true,
      shipping_added_jpy: 230,
      landed_ask_usd: 41.12,
    }])));

    const card = await onlyCard();
    expect(within(card).getByText("Buyer pays shipping")).toBeTruthy();
    expect(within(card).getByText("¥6,000 + ¥230 shipping · $41.12 landed")).toBeTruthy();
  });

  it("lifts each hidden-by-default rule only when asked and labels a lead no longer on sale", async () => {
    const loader = vi.fn(async (filters: MercariLeadFilters) => page(
      filters.includeUnavailable ? [{ ...RAW, source_status: "SOLD_OUT" }] : [RAW],
    ));
    view(loader);

    expect(within(await onlyCard()).queryByText("Sold")).toBeNull();
    fireEvent.change(screen.getByLabelText("Photo check"), { target: { value: "rejected" } });
    await waitFor(() => expect(loader).toHaveBeenLastCalledWith({ ...DEFAULT_LEAD_FILTERS, photo: "rejected" }, null));
    fireEvent.click(screen.getByLabelText("Show dismissed leads"));
    await waitFor(() => expect(loader).toHaveBeenLastCalledWith(
      { ...DEFAULT_LEAD_FILTERS, photo: "rejected", includeDismissed: true }, null,
    ));
    fireEvent.click(screen.getByLabelText("Show listings no longer on sale"));
    await waitFor(() => expect(loader).toHaveBeenLastCalledWith(
      { ...DEFAULT_LEAD_FILTERS, photo: "rejected", includeDismissed: true, includeUnavailable: true }, null,
    ));
    expect(within(await onlyCard()).getByText("Sold")).toBeTruthy();
  });

  it("renders a retryable error and recovers without stale rows", async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("temporary fixture failure"))
      .mockResolvedValueOnce(page([RAW]));
    view(loader);

    expect((await screen.findByRole("alert")).textContent).toContain("temporary fixture failure");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(RAW.sanitized_title)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains an operator refusal without a transient retry", async () => {
    view(vi.fn().mockRejectedValue(new MercariLeadsRequestError(403, "Forbidden")));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Operator access required");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("records a dismissal only with a reason and keeps the lead visible as dismissed", async () => {
    const actor = vi.fn(async () => {});
    view(vi.fn(async () => page([RAW])), actor);

    await onlyCard();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    const confirm = screen.getByRole("button", { name: "Confirm dismissal" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "   " } });
    fireEvent.submit(confirm.closest("form")!);
    expect(actor).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: " PSA10相当, raw " } });
    fireEvent.submit(confirm.closest("form")!);

    await waitFor(() => expect(actor).toHaveBeenCalledWith("m12345678901", "dismissed", "PSA10相当, raw"));
    expect(await screen.findByText("Dismissed")).toBeTruthy();
    expect(screen.getByText("Dismissed: PSA10相当, raw")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(screen.getAllByTestId("mercari-lead-card")).toHaveLength(1);
  });

  it("requests a photo check and surfaces an action failure inline", async () => {
    const actor = vi.fn()
      .mockRejectedValueOnce(new MercariLeadsRequestError(404, "Lead not found"))
      .mockResolvedValueOnce(undefined);
    view(vi.fn(async () => page([RAW])), actor);

    await onlyCard();
    fireEvent.click(screen.getByRole("button", { name: "Request photo check" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Lead not found");
    expect(screen.queryByText("Photo check requested")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Request photo check" }));
    expect(await screen.findByText("Photo check requested")).toBeTruthy();
    expect(actor).toHaveBeenLastCalledWith("m12345678901", "photo_check_requested", "");
    expect(screen.queryByRole("button", { name: "Request photo check" })).toBeNull();
  });

  it("appends unique pages through a cursor that can end inside the rows without a multiple", async () => {
    const cursor = { after: null, after_key: RAW.external_item_id };
    const next = { ...RAW, external_item_id: "m55555555555", canonical_url: "https://jp.mercari.com/item/m55555555555" };
    const loader = vi.fn(async (_filters: MercariLeadFilters, requested: MercariLeadCursor | null) => (
      requested ? page([RAW, next]) : page([RAW], cursor)
    ));
    view(loader);

    await onlyCard();
    fireEvent.click(screen.getByRole("button", { name: "Load more leads" }));
    await waitFor(() => expect(screen.getAllByTestId("mercari-lead-card")).toHaveLength(2));
    expect(loader).toHaveBeenLastCalledWith(DEFAULT_LEAD_FILTERS, cursor);
  });
});

describe("parseMercariLeads", () => {
  it("accepts every lane's real shape and numeric strings", () => {
    expect(parseMercariLeads([RAW, PSA10, UNREAD_PSA, UNPRICED, DAMAGED_VINTAGE])).toHaveLength(5);
    expect(parseMercariLeads([{ ...RAW, ask_jpy: "6000", multiple: "2.477" }])[0]).toMatchObject({ ask_jpy: 6000, multiple: 2.477 });
  });

  it("fails closed on a PSA row carrying a raw value or another grade's value", () => {
    expect(() => parseMercariLeads([{ ...PSA10, value_psa_grade: 0 }])).toThrow("Invalid Mercari lead PSA value");
    expect(() => parseMercariLeads([{ ...PSA10, value_psa_grade: 9 }])).toThrow("Invalid Mercari lead PSA value");
    expect(() => parseMercariLeads([{ ...UNREAD_PSA, value_usd: 480, value_psa_grade: 10 }])).toThrow("Invalid Mercari lead PSA value");
    expect(() => parseMercariLeads([{ ...UNREAD_PSA, multiple: 2 }])).toThrow("Invalid Mercari lead PSA value");
    expect(() => parseMercariLeads([{ ...PSA10, holder_hint: "psa_9" }])).toThrow("Invalid Mercari lead grade");
  });

  it("fails closed on a raw row carrying a PSA value or a PSA title", () => {
    expect(() => parseMercariLeads([{ ...RAW, value_psa_grade: 10 }])).toThrow("Invalid Mercari lead raw value");
    expect(() => parseMercariLeads([{ ...RAW, holder_hint: "psa_10", title_psa_grade: 10 }])).toThrow("Invalid Mercari lead raw value");
    expect(() => parseMercariLeads([{ ...RAW, value_usd: null }])).toThrow("Invalid Mercari lead raw value");
  });

  it("accepts the 000617 shapes: damaged vintage with a multiple, modern 3-6 evidence, thin PSA evidence", () => {
    const [damaged, modernEvidence, thinPsa] = parseMercariLeads([
      DAMAGED_VINTAGE,
      { ...RAW, seller_condition_id: "4", multiple: null, multiple_withheld_reason: "seller_condition_3_6" },
      { ...PSA10, value_sample_count: 2, multiple: null, multiple_withheld_reason: "psa_thin_comps" },
    ]);
    expect(damaged).toMatchObject({ value_condition: "damaged_p25", value_usd: 45, nm_value_usd: 120, multiple: 1.379 });
    expect(modernEvidence).toMatchObject({ value_condition: "nm", multiple: null, multiple_withheld_reason: "seller_condition_3_6" });
    expect(thinPsa).toMatchObject({ value_usd: 480, value_psa_grade: 10, multiple_withheld_reason: "psa_thin_comps" });
    // A damaged value may equal the Near Mint one when the window's P25 is its P50-P75 midpoint.
    expect(parseMercariLeads([{ ...DAMAGED_VINTAGE, value_usd: 120 }])[0].value_usd).toBe(120);
  });

  it("still refuses a multiple on a raw card rated 3 to 6 unless it is vintage priced as damaged", () => {
    // Modern codes 3-6 are evidence only, at the Near Mint value.
    expect(() => parseMercariLeads([{ ...RAW, seller_condition_id: "4" }])).toThrow("Invalid Mercari lead seller condition");
    expect(() => parseMercariLeads([{
      ...RAW, seller_condition_id: "4", value_usd: 45, value_condition: "damaged_p25", nm_value_usd: 120,
    }])).toThrow("Invalid Mercari lead seller condition");
    // A vintage card rated 3-6 valued Near Mint must not carry a multiple.
    expect(() => parseMercariLeads([{
      ...DAMAGED_VINTAGE, value_usd: 120, value_condition: "nm", nm_value_usd: 120,
    }])).toThrow("Invalid Mercari lead seller condition");
    // Nor is a damaged vintage card evidence, nor a card rated 1-2 priced as damaged.
    expect(() => parseMercariLeads([{
      ...DAMAGED_VINTAGE, multiple: null, multiple_withheld_reason: "seller_condition_3_6",
    }])).toThrow("Invalid Mercari lead seller condition");
    expect(() => parseMercariLeads([{ ...DAMAGED_VINTAGE, seller_condition_id: "2" }])).toThrow("Invalid Mercari lead seller condition");
    expect(() => parseMercariLeads([{ ...RAW, multiple: null, multiple_withheld_reason: "psa_thin_comps" }])).toThrow("Invalid Mercari lead seller condition");
  });

  it("fails closed on a raw value condition the CHECKs forbid", () => {
    expect(() => parseMercariLeads([{ ...DAMAGED_VINTAGE, value_usd: 130 }])).toThrow("Invalid Mercari lead raw value");
    expect(() => parseMercariLeads([{ ...RAW, nm_value_usd: 150 }])).toThrow("Invalid Mercari lead raw value");
    expect(() => parseMercariLeads([{ ...RAW, value_condition: null }])).toThrow("Invalid Mercari lead raw value");
    expect(() => parseMercariLeads([{ ...RAW, nm_value_usd: null }])).toThrow("Invalid Mercari lead raw value");
    expect(() => parseMercariLeads([{ ...RAW, value_condition: "lp" }])).toThrow("Invalid Mercari lead value condition");
  });

  it("fails closed on a PSA row with a raw value condition or a misplaced thin-comps reason", () => {
    expect(() => parseMercariLeads([{ ...PSA10, value_condition: "nm", nm_value_usd: 480 }])).toThrow("Invalid Mercari lead PSA value");
    expect(() => parseMercariLeads([{ ...PSA10, nm_value_usd: 480 }])).toThrow("Invalid Mercari lead PSA value");
    expect(() => parseMercariLeads([{ ...PSA10, multiple_withheld_reason: "psa_thin_comps" }])).toThrow("Invalid Mercari lead withheld reason");
    expect(() => parseMercariLeads([{ ...PSA10, multiple: null, multiple_withheld_reason: "seller_condition_3_6" }])).toThrow("Invalid Mercari lead PSA value");
    expect(() => parseMercariLeads([{ ...UNREAD_PSA, multiple_withheld_reason: "psa_thin_comps" }])).toThrow("Invalid Mercari lead PSA value");
  });

  it("fails closed on an unpriced row with a value or no reason", () => {
    expect(() => parseMercariLeads([{ ...UNPRICED, value_usd: 10, value_psa_grade: 0 }])).toThrow("Invalid Mercari lead unpriced row");
    expect(() => parseMercariLeads([{ ...UNPRICED, unpriced_reason: " " }])).toThrow("Invalid Mercari lead unpriced row");
    expect(() => parseMercariLeads([{ ...UNPRICED, holder_hint: "psa_unknown" }])).toThrow("Invalid Mercari lead unpriced row");
    expect(() => parseMercariLeads([{ ...UNPRICED, value_condition: "nm" }])).toThrow("Invalid Mercari lead unpriced row");
    expect(() => parseMercariLeads([{ ...UNPRICED, multiple_withheld_reason: "psa_thin_comps" }])).toThrow("Invalid Mercari lead unpriced row");
  });

  it("fails closed on economics and identity the view should never produce", () => {
    expect(() => parseMercariLeads([{ ...RAW, net_value_usd: null }])).toThrow("Invalid Mercari lead net value");
    expect(() => parseMercariLeads([{ ...RAW, net_value_usd: -1 }])).toThrow("Invalid Mercari lead multiple");
    expect(() => parseMercariLeads([{ ...RAW, multiple: null }])).toThrow("Invalid Mercari lead withheld reason");
    expect(() => parseMercariLeads([{ ...RAW, multiple_withheld_reason: "cheap" }])).toThrow("Invalid Mercari lead withheld reason");
    expect(() => parseMercariLeads([{ ...RAW, canonical_url: "https://evil.example/item/m12345678901" }])).toThrow("Invalid Mercari lead URL");
    expect(() => parseMercariLeads([{ ...RAW, canonical_url: "https://jp.mercari.com/item/m99999999999" }])).toThrow("Invalid Mercari lead URL");
    expect(() => parseMercariLeads([{ ...RAW, external_item_id: "m1" }])).toThrow("Invalid Mercari lead id");
    expect(() => parseMercariLeads([{ ...RAW, lane: "graded" }])).toThrow("Invalid Mercari lead lane");
    expect(() => parseMercariLeads([{ ...RAW, buyer_pays_shipping: true }])).toThrow("Invalid Mercari lead shipping payer");
    expect(() => parseMercariLeads([{ ...RAW, shipping_added_jpy: 230 }])).toThrow("Invalid Mercari lead shipping");
    expect(() => parseMercariLeads([{ ...RAW, title_card_in_photo_scope: null }])).toThrow("Invalid Mercari lead field: title_card_in_photo_scope");
    expect(() => parseMercariLeads([{ ...RAW, match_tier: "" }])).toThrow("Invalid Mercari lead field: match_tier");
    expect(() => parseMercariLeads([{ ...RAW, seller_condition_id: "7" }])).toThrow("Invalid Mercari lead seller condition");
    expect(() => parseMercariLeads([{ ...RAW, photo_check_state: "maybe" }])).toThrow("Invalid Mercari lead photo state");
    expect(() => parseMercariLeads([{ ...RAW, ask_jpy: 0 }])).toThrow("Invalid Mercari lead ask");
    expect(() => parseMercariLeads([{ ...RAW, value_as_of: "yesterday" }])).toThrow("Invalid Mercari lead value date");
    expect(() => parseMercariLeads([{ ...RAW, value_window_days: 90 }])).toThrow("Invalid Mercari lead value window");
    expect(() => parseMercariLeads([{ ...RAW, image_url: "javascript:alert(1)" }])).toThrow("Invalid Mercari lead URL scheme");
    expect(() => parseMercariLeads([{ ...RAW, latest_lead_action: "recheck_requested" }])).toThrow("Invalid Mercari lead action");
    expect(() => parseMercariLeads([{ ...RAW, dismissed: "false" }])).toThrow("Invalid Mercari lead field: dismissed");
  });
});

describe("MercariTab", () => {
  const dealsPage: MercariDealsPage = { deals: [], nextCursor: null };

  function tab(leadsLoader: Loader, dealsLoader = vi.fn(async () => dealsPage)) {
    render(
      <LanguageProvider>
        <MercariTab leadsLoader={leadsLoader} dealsLoader={dealsLoader} />
      </LanguageProvider>,
    );
    return dealsLoader;
  }

  it("opens on Leads and switches to the unchanged Verified deals view", async () => {
    const leadsLoader = vi.fn(async () => page([RAW]));
    const dealsLoader = tab(leadsLoader);

    expect(screen.getByRole("tab", { name: "Leads" }).hasAttribute("data-active")).toBe(true);
    expect(await screen.findByRole("heading", { name: "Mercari leads" })).toBeTruthy();
    expect(dealsLoader).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Verified" }));

    expect(await screen.findByRole("heading", { name: "Mercari deals" })).toBeTruthy();
    expect(await screen.findByText("No Mercari listings found")).toBeTruthy();
    expect(dealsLoader).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "Mercari leads" })).toBeNull();
    expect(window.location.search).toBe("?feed=verified");

    fireEvent.click(screen.getByRole("tab", { name: "Leads" }));
    expect(await screen.findByRole("heading", { name: "Mercari leads" })).toBeTruthy();
    expect(window.location.search).toBe("");
  });

  it("opens on Verified when the URL says so", async () => {
    window.history.replaceState(null, "", "/dashboard?view=mercari&feed=verified");
    const leadsLoader = vi.fn(async () => page([]));
    const dealsLoader = tab(leadsLoader);

    expect(await screen.findByRole("heading", { name: "Mercari deals" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Verified" }).hasAttribute("data-active")).toBe(true);
    expect(leadsLoader).not.toHaveBeenCalled();
    expect(dealsLoader).toHaveBeenCalledTimes(1);
  });
});
