// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "./LanguageContext";
import MercariDealsView, {
  DEFAULT_FILTERS,
  MercariDealsRequestError,
  parseMercariDeals,
  type MercariDeal,
  type MercariDealCursor,
  type MercariDealFilters,
  type MercariDealsPage,
} from "./MercariDealsView";

const DEAL: MercariDeal = {
  external_item_id: "m12345678901",
  source_item_type: "mercari",
  canonical_url: "https://jp.mercari.com/item/m12345678901",
  source_search_url: "https://jp.mercari.com/search?keyword=%E3%83%AA%E3%82%B6%E3%83%BC%E3%83%89%E3%83%B3&status=on_sale",
  evidence_lane: "strict",
  confidence_tier: "strict_analytics",
  reason_codes: ["strict_analytics_eligible"],
  sanitized_title: "リザードン PSA10 25th",
  current_card_uid: "6f3c0a0e-7d8e-4f5e-9a0b-1c2d3e4f5a6b",
  regional_name: "リザードン",
  english_name: "Charizard",
  set_code: "S8a-P",
  card_number: "001/028",
  misc_info: "UNKNOWN",
  image_url: "https://images.example.test/charizard.png",
  holder_kind: "graded",
  psa_grade: 10,
  condition_display_name: "N/A",
  seller_condition_id: "2",
  ask_jpy: 120000,
  observed_at: "2026-10-22T10:15:00+09:00",
  freshness_status: "fresh",
  freshness_age_hours: 3.4,
  jpy_to_usd_rate: 0.0066,
  conservative_exit_jpy: 180000,
  conservative_exit_basis: "p25",
  economics_status: "computed",
  net_profit_usd: 210.5,
  roi: 0.265,
  latest_item_action: null,
  latest_item_action_reason: null,
  latest_item_action_at: null,
};

function page(deals: MercariDeal[], nextCursor: MercariDealCursor | null = null): MercariDealsPage {
  return { deals, nextCursor };
}

type Loader = (filters: MercariDealFilters, cursor: MercariDealCursor | null) => Promise<MercariDealsPage>;
type Actor = (id: string, action: "dismissed" | "recheck_requested", reason: string) => Promise<void>;

function view(loader: Loader, actor: Actor = async () => {}) {
  return render(
    <LanguageProvider>
      <MercariDealsView loader={loader} actor={actor} />
    </LanguageProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("MercariDealsView", () => {
  it("keeps a visible loading state until listings arrive", async () => {
    let resolve!: (deals: MercariDeal[]) => void;
    const loader = vi.fn(() => new Promise<MercariDealsPage>((done) => {
      resolve = (deals) => done(page(deals));
    }));
    view(loader);

    expect(screen.getByRole("status").textContent).toContain("Loading Mercari listings");
    await act(async () => resolve([]));
    expect(await screen.findByText("No Mercari listings found")).toBeTruthy();
    expect(loader).toHaveBeenCalledWith(DEFAULT_FILTERS, null);
  });

  it("shows identity, holder, seller condition, ask, exit, economics, and the two Mercari links", async () => {
    const loader = vi.fn(async () => page([DEAL]));
    view(loader);

    expect(await screen.findAllByTestId("mercari-deal-card")).toHaveLength(1);
    expect(screen.getByText("リザードン")).toBeTruthy();
    expect(screen.getByText("PSA 10")).toBeTruthy();
    expect(screen.getByText("Strict offer")).toBeTruthy();
    expect(screen.getByText("Fresh")).toBeTruthy();
    expect(screen.getByText("S8a-P 001/028 · Charizard")).toBeTruthy();
    expect(screen.getByText("Observed (JST): Oct 22, 2026, 10:15 AM (3 h ago)")).toBeTruthy();
    expect(screen.getByText("¥120,000 ($792.00)")).toBeTruthy();
    expect(screen.getByText("未使用に近い (close to unused)")).toBeTruthy();
    expect(screen.getByText("¥180,000 (comp P25)")).toBeTruthy();
    expect(screen.getByText("$210.50 · ROI +26.5%")).toBeTruthy();
    expect(screen.getByText("strict_analytics_eligible")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open listing" }).getAttribute("href")).toBe(DEAL.canonical_url);
    expect(screen.getByRole("link", { name: "Open Mercari search" }).getAttribute("href")).toBe(DEAL.source_search_url);
    const image = screen.getByRole("img", { name: "Catalog image of リザードン (S8a-P 001/028)" });
    expect(image.getAttribute("src")).toContain("/api/proxy-image?url=");
    expect(document.body.textContent).toContain("Nothing here is a completed sale");
  });

  it("explains missing economics instead of showing a number", async () => {
    const loader = vi.fn(async () => page([{
      ...DEAL,
      conservative_exit_jpy: null,
      conservative_exit_basis: "missing_exit_reference",
      economics_status: "missing_exit_reference",
      net_profit_usd: null,
      roi: null,
      jpy_to_usd_rate: null,
    }]));
    view(loader);

    expect(await screen.findAllByTestId("mercari-deal-card")).toHaveLength(1);
    expect(screen.getByText("¥120,000")).toBeTruthy();
    expect(screen.getAllByText("No exit reference for this card and grade yet")).toHaveLength(2);
  });

  it("applies the holder, lane, and dismissed filters and resets paging", async () => {
    const loader = vi.fn(async (filters: MercariDealFilters) => page(
      filters.holder === "raw" ? [] : [DEAL],
    ));
    view(loader);

    expect(await screen.findAllByTestId("mercari-deal-card")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Holder"), { target: { value: "raw" } });
    fireEvent.change(screen.getByLabelText("Evidence"), { target: { value: "candidate" } });
    fireEvent.click(screen.getByLabelText("Show dismissed listings"));
    fireEvent.submit(screen.getByRole("button", { name: "Show listings" }).closest("form")!);

    expect(await screen.findByText("No Mercari listings found")).toBeTruthy();
    expect(loader).toHaveBeenLastCalledWith({ holder: "raw", lane: "candidate", includeDismissed: true }, null);
  });

  it("renders a retryable error and recovers without stale rows", async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("temporary fixture failure"))
      .mockResolvedValueOnce(page([DEAL]));
    view(loader);

    expect((await screen.findByRole("alert")).textContent).toContain("temporary fixture failure");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("リザードン")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains an operator refusal without a transient retry", async () => {
    const loader = vi.fn().mockRejectedValue(new MercariDealsRequestError(403, "Forbidden"));
    view(loader);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Operator access required");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    const signIn = screen.getByRole("link", { name: "Sign in with an operator account" });
    expect(signIn.getAttribute("href")).toBe("/login");
  });

  it("records a dismissal with a reason and keeps the listing visible as dismissed", async () => {
    const actor = vi.fn(async () => {});
    view(vi.fn(async () => page([DEAL])), actor);

    expect(await screen.findAllByTestId("mercari-deal-card")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    const confirm = screen.getByRole("button", { name: "Confirm dismissal" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: " wrong card " } });
    fireEvent.submit(confirm.closest("form")!);

    await waitFor(() => {
      expect(actor).toHaveBeenCalledWith("m12345678901", "dismissed", "wrong card");
    });
    expect(await screen.findByText("Dismissed")).toBeTruthy();
    expect(screen.getByText("Dismissed: wrong card")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(screen.getAllByTestId("mercari-deal-card")).toHaveLength(1);
  });

  it("surfaces an action failure inline and keeps the listing", async () => {
    const actor = vi.fn().mockRejectedValue(new MercariDealsRequestError(409, "Listing id is outside the recorded shape"));
    view(vi.fn(async () => page([DEAL])), actor);

    expect(await screen.findAllByTestId("mercari-deal-card")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Request recheck" }));

    expect((await screen.findByRole("alert")).textContent).toContain("outside the recorded shape");
    expect(screen.getAllByTestId("mercari-deal-card")).toHaveLength(1);
    expect(screen.queryByText("Recheck requested")).toBeNull();
  });

  it("appends unique pages through the cursor", async () => {
    const cursor = { before: DEAL.observed_at, before_key: DEAL.external_item_id };
    const second = { ...DEAL, external_item_id: "m22222222222", canonical_url: "https://jp.mercari.com/item/m22222222222" };
    const loader = vi.fn(async (_filters: MercariDealFilters, requested: MercariDealCursor | null) => (
      requested ? page([DEAL, second]) : page([DEAL], cursor)
    ));
    view(loader);

    expect(await screen.findAllByTestId("mercari-deal-card")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Load more listings" }));
    await waitFor(() => {
      expect(screen.getAllByTestId("mercari-deal-card")).toHaveLength(2);
    });
    expect(loader).toHaveBeenLastCalledWith(DEFAULT_FILTERS, cursor);
  });

  it("fails closed on rows the view should never produce", () => {
    expect(() => parseMercariDeals([{ ...DEAL, canonical_url: "https://evil.example/item/m12345678901" }])).toThrow("Invalid Mercari deal URL: canonical_url");
    expect(() => parseMercariDeals([{ ...DEAL, source_search_url: "https://jp.mercari.com/item/m1" }])).toThrow("Invalid Mercari deal URL: source_search_url");
    expect(() => parseMercariDeals([{ ...DEAL, external_item_id: "m1" }])).toThrow("Invalid Mercari deal id");
    expect(() => parseMercariDeals([{ ...DEAL, holder_kind: "raw" }])).toThrow("Invalid Mercari deal grade");
    expect(() => parseMercariDeals([{ ...DEAL, seller_condition_id: "7" }])).toThrow("Invalid Mercari deal seller condition");
    expect(() => parseMercariDeals([{ ...DEAL, ask_jpy: 0 }])).toThrow("Invalid Mercari deal ask");
    expect(() => parseMercariDeals([{ ...DEAL, latest_item_action: "bought" }])).toThrow("Invalid Mercari deal action");
    expect(parseMercariDeals([{ ...DEAL, ask_jpy: "120000", roi: "0.265" }])[0]).toMatchObject({ ask_jpy: 120000, roi: 0.265 });
  });
});
