// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "./LanguageContext";
import TwitterBuybacksView, { BUYLIST_PAGE } from "./TwitterBuybacksView";
import {
  BuybackRequestError,
  type BuybackBuylistLoader,
  type BuybackOverviewLoader,
  parseBuybackBuylist,
  parseBuybackOverview,
} from "./twitter-buybacks";
import { CLOVER, NOW, buylistDoc, overviewDoc, rowDoc } from "./twitter-buybacks.test-fixtures";

const overviewLoader: BuybackOverviewLoader = async () => parseBuybackOverview(overviewDoc());
const buylistLoader: BuybackBuylistLoader = async () => parseBuybackBuylist(buylistDoc());

function view(
  loaders: { overview?: BuybackOverviewLoader; buylist?: BuybackBuylistLoader } = {},
) {
  return render(
    <LanguageProvider>
      <TwitterBuybacksView
        overviewLoader={loaders.overview ?? overviewLoader}
        buylistLoader={loaders.buylist ?? buylistLoader}
        now={() => NOW}
      />
    </LanguageProvider>,
  );
}

function card(source: string) {
  const element = screen.getAllByTestId("buyback-source-card").find((node) => node.dataset.source === source);
  if (!element) throw new Error(`no card for ${source}`);
  return within(element);
}

function chip(group: string, name: string) {
  return within(screen.getByRole("group", { name: group })).getByRole("button", { name });
}

function rowNames() {
  return screen.getAllByTestId("buyback-row").map((row) => row.dataset.cardId);
}

beforeEach(() => {
  window.history.replaceState(null, "", "/dashboard?view=buybacks");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("TwitterBuybacksView overview", () => {
  it("shows every source with its freshness at a glance", async () => {
    view();

    await screen.findAllByTestId("buyback-source-card");
    expect(screen.getAllByTestId("buyback-source-card").map((node) => node.dataset.source))
      .toEqual(["pdg", "laurier", "clover_base"]);
    const summary = within(screen.getByTestId("buybacks-summary"));
    expect(summary.getByText("3 sources")).toBeTruthy();
    expect(summary.getByText("1 fresh")).toBeTruthy();
    expect(summary.getByText("1 aging")).toBeTruthy();
    expect(summary.getByText("1 expired")).toBeTruthy();
    expect(summary.getByText(/Auto-accept on: 826 of 50,000 promoted since Nov 5, 2026, 9:00 AM JST/)).toBeTruthy();

    const pdg = card("pdg");
    expect(pdg.getByTestId("buyback-freshness").dataset.freshness).toBe("fresh");
    expect(pdg.getByText("@PDGcollectors · @PDGcollectors_2")).toBeTruthy();
    // The tweet time in JST: 06:47 UTC is 15:47 JST.
    expect(pdg.getByText("Nov 5, 2026, 3:47 PM JST")).toBeTruthy();
    expect(pdg.getByText(/Read Nov 5, 2026, 7:38 PM JST/)).toBeTruthy();
    expect(pdg.getByText("13 cells: 11 auto-accepted, 2 approved")).toBeTruthy();
    expect(pdg.getByText("371 live bids")).toBeTruthy();
    expect(pdg.getByText(/415 of 415 cards live/)).toBeTruthy();
    expect(pdg.getByText(/310 of 2,000 today/)).toBeTruthy();
    expect(pdg.getByTestId("buyback-fingerprint-current")).toBeTruthy();
    expect(pdg.getByRole("link", { name: /Open post/ }).getAttribute("href"))
      .toBe("https://twitter.com/PDGcollectors/status/2118233672491073776");

    const laurier = card("laurier");
    expect(laurier.getByTestId("buyback-freshness").dataset.freshness).toBe("aging");
    expect(laurier.getByText("Not read yet", { exact: false })).toBeTruthy();
    expect(laurier.getByTestId("buyback-fingerprint-stale")).toBeTruthy();
    expect(laurier.getByTestId("buyback-polling-problem").textContent).toBe("@laurier_akiba2: paused");

    const clover = card("clover_base");
    expect(clover.getByTestId("buyback-freshness").dataset.freshness).toBe("expired");
    expect(clover.getByText("Not configured")).toBeTruthy();
    expect(clover.getByText("Never checked")).toBeTruthy();
    expect(clover.getByText("0 live bids")).toBeTruthy();
  });

  it("filters the cards by freshness and the panel by name", async () => {
    view();
    await screen.findAllByTestId("buyback-source-card");

    fireEvent.click(chip("Freshness", "1 expired"));
    expect(screen.getAllByTestId("buyback-source-card").map((node) => node.dataset.source)).toEqual(["clover_base"]);
    fireEvent.click(chip("Freshness", "All 3"));
    expect(screen.getAllByTestId("buyback-source-card")).toHaveLength(3);

    const panel = within(screen.getByTestId("buyback-sources"));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search sources" }), { target: { value: "@laurier_akiba2" } });
    expect(panel.getAllByRole("button").map((button) => button.textContent?.split("@")[0])).toEqual(["All sources", "laurier"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search sources" }), { target: { value: "nobody" } });
    expect(screen.getByText("No source matches.")).toBeTruthy();
  });

  it("says the overview waits for the migration while the RPCs are absent", async () => {
    view({ overview: async () => null });

    expect(await screen.findByTestId("buybacks-unavailable")).toBeTruthy();
    expect(screen.getByText("The buyback overview is not available yet")).toBeTruthy();
    expect(screen.getByText(/backend migration 000628/)).toBeTruthy();
    expect(screen.queryByTestId("buyback-source-card")).toBeNull();
  });

  it("shows the empty state when no source has a sheet", async () => {
    view({ overview: async () => parseBuybackOverview(overviewDoc([])) });

    expect(await screen.findByTestId("buybacks-empty")).toBeTruthy();
    expect(screen.getByText("No buyback sources yet")).toBeTruthy();
  });

  it("keeps a failed load retryable and names the administrator boundary", async () => {
    const failing = vi.fn<BuybackOverviewLoader>()
      .mockRejectedValueOnce(new BuybackRequestError(500, "Buyback sources are unavailable"))
      .mockResolvedValue(parseBuybackOverview(overviewDoc()));
    view({ overview: failing });

    expect(await screen.findByText("Buyback sources could not be loaded")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findAllByTestId("buyback-source-card");
    expect(failing).toHaveBeenCalledTimes(2);

    cleanup();
    view({ overview: async () => { throw new BuybackRequestError(403, "Forbidden"); } });
    expect(await screen.findByText("Administrator access required")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

    cleanup();
    view({ overview: async () => { throw new BuybackRequestError(401, "Unauthorized"); } });
    expect(await screen.findByText("Your session ended")).toBeTruthy();
  });

  it("speaks Japanese", async () => {
    localStorage.setItem("language", "ja");
    view();

    await screen.findAllByTestId("buyback-source-card");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Twitter 買取");
    expect(card("pdg").getByText("13 マス：自動承認 11、承認 2")).toBeTruthy();
    expect(card("clover_base").getByText("未設定")).toBeTruthy();
  });
});

describe("TwitterBuybacksView buylist", () => {
  async function openPdg(loaders: { buylist?: BuybackBuylistLoader } = {}) {
    view(loaders);
    await screen.findAllByTestId("buyback-source-card");
    fireEvent.click(card("pdg").getByRole("button", { name: "Open buylist" }));
    await screen.findAllByTestId("buyback-row");
  }

  it("opens a source's buylist and puts it in the URL", async () => {
    const loader = vi.fn<BuybackBuylistLoader>(buylistLoader);
    await openPdg({ buylist: loader });

    expect(loader).toHaveBeenCalledWith("pdg");
    expect(window.location.search).toBe("?view=buybacks&shop=pdg");
    expect(screen.getByTestId("buyback-source-detail")).toBeTruthy();
    expect(screen.getByText(/from the tweets of Nov 2, 2026, 3:47 PM JST to Nov 5, 2026, 3:47 PM JST/)).toBeTruthy();
    expect(screen.getByTestId("buyback-row-count").textContent).toBe("4 of 4 cards · 2 verified");

    fireEvent.click(screen.getByRole("button", { name: "Back to all sources" }));
    expect(window.location.search).toBe("?view=buybacks");
    expect(screen.getAllByTestId("buyback-source-card")).toHaveLength(3);
  });

  it("renders each row's card, grade, price, verification, time and tweets", async () => {
    await openPdg();

    const row = (id: string) => within(screen.getAllByTestId("buyback-row").find((node) => node.dataset.cardId === id)!);
    const mew = row("794930");
    expect(mew.getByText("Shining Mew")).toBeTruthy();
    expect(mew.getByText("ひかるミュウ")).toBeTruthy();
    expect(mew.getByText("Unnumbered Promotional cards (Old Series) · OLD-UPC · No. 旧裏")).toBeTruthy();
    expect(mew.getByTestId("buyback-price").textContent).toBe("¥90,000");
    expect(mew.getByText("Auto-accepted")).toBeTruthy();
    expect(mew.getByText("Raw")).toBeTruthy();
    expect(mew.getByText("Quoted Nov 5, 2026, 11:48 AM JST")).toBeTruthy();
    // The identical quote from both accounts is one row with both posts.
    expect(mew.getAllByRole("link", { name: /^Open @/ }).map((link) => link.getAttribute("href"))).toEqual([
      "https://twitter.com/PDGcollectors_2/status/2118173590722052528",
      "https://twitter.com/PDGcollectors/status/2118172843347505186",
    ]);
    const crops = mew.getByTestId("buyback-crop");
    expect(crops.getAttribute("href")).toMatch(/^https:\/\/pub-test\.r2\.dev\//);
    const [cardImage, priceImage] = within(crops).getAllByRole("img");
    expect(cardImage.getAttribute("alt")).toBe("Shining Mew as cropped from the sheet");
    expect(cardImage.style.objectPosition).toBe("-947px -374px");
    expect(cardImage.getAttribute("loading")).toBe("lazy");
    expect(priceImage.style.objectPosition).toBe("-931px -1052px");

    // The default order is the newest quote first: Serena (03:50 UTC) leads.
    expect(rowNames()).toEqual(["799208", "794930", "800001", "800002"]);
    const serena = row("799208");
    expect(serena.getByTestId("buyback-price").textContent).toBe("¥477,000");
    expect(serena.getByTestId("buyback-read-price").textContent).toBe("read ¥1,680,000");
    expect(serena.getByText("Approved")).toBeTruthy();
    expect(serena.getByText("PSA 10")).toBeTruthy();

    const charizard = row("800001");
    expect(charizard.getByText("In review")).toBeTruthy();
    expect(charizard.queryByTestId("buyback-crop")).toBeNull();
    expect(charizard.queryByTestId("buyback-read-price")).toBeNull();
    const pikachu = row("800002");
    expect(pikachu.getByText("Expired unreviewed")).toBeTruthy();
    expect(pikachu.getByText(/· No. 025 · ミラー/)).toBeTruthy();
  });

  it("filters by grade, verification and search, sorts by price, and clears", async () => {
    await openPdg();

    fireEvent.click(chip("Grade", "PSA 10"));
    expect(rowNames()).toEqual(["799208"]);
    fireEvent.click(chip("Grade", "All grades"));
    fireEvent.click(chip("Verification", "In review"));
    expect(rowNames()).toEqual(["800001", "800002"]);
    fireEvent.click(chip("Verification", "Verified"));
    expect(rowNames()).toEqual(["799208", "794930"]);
    fireEvent.click(chip("Verification", "All quotes"));

    fireEvent.change(screen.getByRole("searchbox", { name: "Search card or set" }), { target: { value: "151" } });
    expect(rowNames()).toEqual(["800001", "800002"]);
    expect(screen.getByTestId("buyback-row-count").textContent).toBe("2 of 4 cards · 2 verified");
    fireEvent.click(chip("Sort", "Lowest price"));
    expect(rowNames()).toEqual(["800002", "800001"]);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search card or set" }), { target: { value: "no such card" } });
    expect(screen.getByTestId("buyback-no-match")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(rowNames()).toHaveLength(4);
    fireEvent.click(chip("Sort", "Highest price"));
    expect(rowNames()).toEqual(["799208", "794930", "800001", "800002"]);
  });

  it("renders a long buylist a page at a time", async () => {
    const rows = Array.from({ length: BUYLIST_PAGE + 30 }, (_, index) => rowDoc({
      card: { card_id: 1000 + index, name: `カード${index}` },
      quoted_at: new Date(Date.parse("2026-11-05T02:00:00Z") - index * 60_000).toISOString(),
      tweets: [{ tweet_id: `${index}`, tweet_url: `https://twitter.com/PDGcollectors/status/${index}`, account: "PDGcollectors", tweeted_at: "2026-11-05T02:00:00Z" }],
    }));
    await openPdg({ buylist: async () => parseBuybackBuylist(buylistDoc({ rows })) });

    expect(screen.getAllByTestId("buyback-row")).toHaveLength(BUYLIST_PAGE);
    fireEvent.click(screen.getByRole("button", { name: "Show 30 more" }));
    expect(screen.getAllByTestId("buyback-row")).toHaveLength(BUYLIST_PAGE + 30);
    expect(screen.queryByRole("button", { name: /^Show \d+ more$/ })).toBeNull();
  });

  it("says when a source's whole buylist has expired", async () => {
    window.history.replaceState(null, "", "/dashboard?view=buybacks&shop=clover_base");
    view({
      buylist: async () => parseBuybackBuylist(buylistDoc({
        source: "clover_base",
        latest_tweet_at: CLOVER.latest_tweet && (CLOVER.latest_tweet as { tweeted_at: string }).tweeted_at,
        window_started_at: "2026-07-31T06:48:59+00:00",
        rows: [rowDoc({ freshness: "expired", status: "expired", verified: false, quoted_at: "2026-08-03T06:48:59+00:00" })],
      })),
    });

    expect(await screen.findByTestId("buyback-all-expired")).toBeTruthy();
    expect(screen.getByTestId("buyback-all-expired").textContent)
      .toMatch(/^Every quote here has expired: the latest buyback tweet is from Aug 3, 2026, 3:48 PM JST \(3 months ago\)\.$/);
    expect(within(screen.getByTestId("buyback-source-detail")).getByText("clover_base")).toBeTruthy();
  });

  it("handles a linked source that has no sheets, and a failed buylist", async () => {
    window.history.replaceState(null, "", "/dashboard?view=buybacks&shop=nobody");
    view({
      buylist: async () => parseBuybackBuylist({
        source: "nobody", known: false, generated_at: "2026-11-05T21:00:00Z", latest_tweet_at: null, window_started_at: null, rows: [],
      }),
    });
    expect(await screen.findByTestId("buyback-unknown-source")).toBeTruthy();
    expect(screen.getByText("No buyback sheets from nobody")).toBeTruthy();
    fireEvent.click(within(screen.getByTestId("buyback-unknown-source")).getByRole("button", { name: "Back to all sources" }));
    expect(window.location.search).toBe("?view=buybacks");

    cleanup();
    window.history.replaceState(null, "", "/dashboard?view=buybacks&shop=pdg");
    const failing = vi.fn<BuybackBuylistLoader>()
      .mockRejectedValueOnce(new BuybackRequestError(500, "The buylist is unavailable"))
      .mockImplementation(buylistLoader);
    view({ buylist: failing });
    expect(await screen.findByText("The buylist could not be loaded")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findAllByTestId("buyback-row");
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("refresh reloads both the overview and the open buylist", async () => {
    const overview = vi.fn<BuybackOverviewLoader>(overviewLoader);
    const buylist = vi.fn<BuybackBuylistLoader>(buylistLoader);
    window.history.replaceState(null, "", "/dashboard?view=buybacks&shop=pdg");
    view({ overview, buylist });
    await screen.findAllByTestId("buyback-row");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    });
    await waitFor(() => expect(buylist).toHaveBeenCalledTimes(2));
    expect(overview).toHaveBeenCalledTimes(2);
  });

  it("keeps every control a 44 px target on a phone", async () => {
    await openPdg();
    for (const name of ["Grade", "Verification", "Sort"]) {
      for (const button of within(screen.getByRole("group", { name })).getAllByRole("button")) {
        expect(button.className, `${name}: ${button.textContent}`).toContain("h-11");
      }
    }
    expect(screen.getByRole("button", { name: "Refresh" }).className).toContain("min-h-11");
  });
});
