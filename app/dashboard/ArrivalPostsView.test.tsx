// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "./LanguageContext";
import ArrivalPostsView, {
  ArrivalPostsRequestError,
  type ArrivalCursor,
  type ArrivalPost,
  type ArrivalPostsPage,
  type ArrivalSourcesLoader,
  parseArrivalPosts,
} from "./ArrivalPostsView";
import {
  COLLAPSED_ACCOUNTS_KEY,
  GROUP_BY_ACCOUNT_KEY,
  type ArrivalSource,
} from "./arrival-accounts";
import { ARRIVALS_WINDOW_KEY } from "./arrival-window";

const POST: ArrivalPost = {
  arrival_key: "alice_shop:2112064092735521045",
  buyer_handle: "alice",
  twitter_handle: "alice_shop",
  tweet_id: "2112064092735521045",
  tweet_url: "https://x.com/alice_shop/status/2112064092735521045",
  tweet_created_at: "2026-10-20T10:15:00+09:00",
  acquired_at: "2026-10-20T10:16:00+09:00",
  last_boosted_at: null,
  boost_count: 0,
  via_retweet_of: null,
  unverified: true,
  media: [{
    source_image_index: 0,
    source_image_url: "https://pbs.twimg.com/media/arrival.jpg",
    content_sha256: "a".repeat(64),
  }],
};

// bob has no entry in lib/source-labels.ts, alice does ("Alice").
const BOB_POST: ArrivalPost = {
  ...POST,
  arrival_key: "bob_shop:2",
  buyer_handle: "bob",
  twitter_handle: "bob_shop",
  tweet_id: "2",
  tweet_url: "https://x.com/bob_shop/status/2",
  tweet_created_at: "2026-10-20T09:00:00+09:00",
  acquired_at: "2026-10-20T09:01:00+09:00",
};

const ALICE_SOURCE: ArrivalSource = {
  buyer_handle: "alice",
  twitter_handle: "alice_shop",
  post_count: 42,
  recent_count: 3,
  latest_post_at: "2026-10-20T10:15:00+09:00",
};

const BOB_SOURCE: ArrivalSource = {
  buyer_handle: "bob",
  twitter_handle: "bob_shop",
  post_count: 7,
  recent_count: 0,
  latest_post_at: "2026-10-21T12:00:00+09:00",
};

function page(posts: ArrivalPost[], nextCursor: ArrivalCursor | null = null): ArrivalPostsPage {
  return { posts, nextCursor };
}

const noSources: ArrivalSourcesLoader = async () => [];

function view(
  loader: (buyerHandle: string, cursor: ArrivalCursor | null) => Promise<ArrivalPostsPage>,
  sourcesLoader: ArrivalSourcesLoader = noSources,
) {
  return render(
    <LanguageProvider>
      <ArrivalPostsView loader={loader} sourcesLoader={sourcesLoader} />
    </LanguageProvider>,
  );
}

function accountList() {
  return within(screen.getByTestId("arrival-accounts"));
}

function windowChip(name: string) {
  return within(screen.getByRole("group", { name: "Time window" })).getByRole("button", { name });
}

beforeEach(() => {
  window.history.replaceState(null, "", "/dashboard?view=arrivals");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ArrivalPostsView", () => {
  // These fixtures carry fixed dates so the JST rendering can be asserted, and
  // the default 48-hour window would hide them as the clock moves on. The
  // viewer here has chosen All; the window itself is covered further down.
  beforeEach(() => {
    localStorage.setItem(ARRIVALS_WINDOW_KEY, "all");
  });

  it("keeps a visible loading state until the post-level evidence arrives", async () => {
    let resolve!: (posts: ArrivalPost[]) => void;
    const loader = vi.fn(() => new Promise<ArrivalPostsPage>((done) => {
      resolve = (posts) => done(page(posts));
    }));
    view(loader);

    const statuses = screen.getAllByRole("status").map((element) => element.textContent).join(" ");
    expect(statuses).toContain("Loading arrival posts");
    await act(async () => resolve([]));
    expect(await screen.findByText("No arrival posts found")).toBeTruthy();
  });

  it("shows the handle first, the label only when curated, evidence images, source URL, and unverified scope", async () => {
    const loader = vi.fn(async (buyerHandle: string) => page(
      buyerHandle === "bob" ? [BOB_POST] : [POST, BOB_POST],
    ));
    view(loader, async () => [ALICE_SOURCE, BOB_SOURCE]);

    const cards = await screen.findAllByTestId("arrival-post-card");
    expect(cards).toHaveLength(2);
    expect(screen.getAllByText("Unverified post")).toHaveLength(2);
    expect(within(cards[0]).getByText("@alice_shop")).toBeTruthy();
    expect(within(cards[0]).getByText("Alice")).toBeTruthy();
    expect(within(cards[1]).getByText("@bob_shop")).toBeTruthy();
    expect(within(cards[1]).queryByText("Bob")).toBeNull();
    expect(within(cards[0]).getByText("Source post time (JST): Oct 20, 2026, 10:15 AM")).toBeTruthy();
    expect(within(cards[0]).getByText("Evidence collected (JST): Oct 20, 2026, 10:16 AM")).toBeTruthy();
    const source = within(cards[0]).getByRole("link", { name: "Open original post" });
    expect(source.getAttribute("href")).toBe(POST.tweet_url);
    const media = within(cards[0]).getByRole("link", { name: "Open original image 1" });
    expect(media.getAttribute("href")).toBe(POST.media[0].source_image_url);
    expect(media.querySelector("img")?.getAttribute("alt")).toBe("Arrival image 1 from Alice");
    expect(within(cards[1]).getByRole("img").getAttribute("alt")).toBe("Arrival image 1 from @bob_shop");
    expect(media.querySelector("img")?.className).toContain("object-contain");
    expect(media.querySelector("img")?.className).not.toContain("object-cover");
    expect(document.body.textContent).toContain("No item, grade, or price has been inferred");
    // Never re-posted: no re-post badge and no "via" line, exactly as before the fields existed.
    expect(screen.queryByTestId("arrival-reposted")).toBeNull();
    expect(screen.queryByTestId("arrival-via")).toBeNull();

    fireEvent.click(accountList().getByRole("button", { name: /@bob_shop/ }));
    await waitFor(() => {
      expect(screen.getAllByTestId("arrival-post-card")).toHaveLength(1);
    });
    expect(loader).toHaveBeenLastCalledWith("bob", null);
    expect(screen.getByText("Showing posts from")).toBeTruthy();
  });

  it("renders a retryable error and recovers without stale rows", async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("temporary fixture failure"))
      .mockResolvedValueOnce(page([POST]));
    view(loader);

    expect((await screen.findByRole("alert")).textContent).toContain("temporary fixture failure");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findAllByTestId("arrival-post-card")).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains permanent administrator refusal once, without a transient retry", async () => {
    const forbidden = () => Promise.reject(new ArrivalPostsRequestError(403, "Forbidden"));
    view(vi.fn(forbidden), vi.fn(forbidden));

    const alert = await screen.findByRole("alert");
    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(alert.textContent).toContain("Administrator access required");
    expect(alert.textContent).toContain("restricted to administrator accounts");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    const signIn = screen.getByRole("link", {
      name: "Sign in with an administrator account",
    });
    expect(signIn.getAttribute("href")).toBe("/login");
    expect(signIn.getAttribute("target")).toBe("_blank");
    // The account panel does not repeat the refusal; it simply has nothing to list.
    expect(accountList().getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByText("Account list could not be loaded")).toBeNull();
  });

  it("fails closed on malformed or item-level responses", () => {
    expect(() => parseArrivalPosts([{ ...POST, unverified: false }])).toThrow("Invalid arrival evidence");
    expect(() => parseArrivalPosts([{ ...POST, media: [] }])).toThrow("Invalid arrival evidence");
    expect(() => parseArrivalPosts([{ ...POST, media: [{ ...POST.media[0], content_sha256: "bad" }] }])).toThrow("Invalid arrival media digest");
    expect(() => parseArrivalPosts([{ ...POST, price_jpy: 1000 }])).toThrow("Forbidden arrival field: price_jpy");
    expect(() => parseArrivalPosts([{ ...POST, last_boosted_at: "yesterday" }])).toThrow("Invalid arrival timestamp: last_boosted_at");
    expect(() => parseArrivalPosts([{ ...POST, boost_count: -1 }])).toThrow("Invalid arrival count: boost_count");
    expect(() => parseArrivalPosts([{ ...POST, boost_count: 1.5 }])).toThrow("Invalid arrival count: boost_count");
    expect(() => parseArrivalPosts([{ ...POST, via_retweet_of: "" }])).toThrow("Invalid arrival field: via_retweet_of");
  });

  it("reads the re-post fields when the backend sends them and defaults them when it does not", () => {
    const legacy: Record<string, unknown> = { ...POST };
    delete legacy.last_boosted_at;
    delete legacy.boost_count;
    delete legacy.via_retweet_of;
    expect(parseArrivalPosts([legacy])).toEqual([POST]);
    expect(parseArrivalPosts([{ ...POST, last_boosted_at: null, boost_count: null, via_retweet_of: null }])).toEqual([POST]);
    expect(parseArrivalPosts([{
      ...POST,
      last_boosted_at: "2026-10-23T01:00:00Z",
      boost_count: "2",
      via_retweet_of: "dave_shop",
    }])).toEqual([{ ...POST, last_boosted_at: "2026-10-23T01:00:00Z", boost_count: 2, via_retweet_of: "dave_shop" }]);
  });

  it("appends unique tied-timestamp pages into the account's group and resets pagination for a selection", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      ...POST,
      arrival_key: `alice_shop:${String(index).padStart(3, "0")}`,
      tweet_id: String(index),
      tweet_url: `https://x.com/alice_shop/status/${index}`,
      tweet_created_at: "2026-10-20T10:15:00+09:00",
    }));
    const cursor = {
      before: "2026-10-20T10:15:00+09:00",
      before_key: firstPage.at(-1)!.arrival_key,
    };
    const secondPage = [
      firstPage.at(-1)!,
      ...Array.from({ length: 5 }, (_, index) => ({
        ...POST,
        arrival_key: `alice_shop:${100 + index}`,
        tweet_id: String(100 + index),
        tweet_url: `https://x.com/alice_shop/status/${100 + index}`,
        tweet_created_at: "2026-10-20T10:15:00+09:00",
      })),
    ];
    const loader = vi.fn(async (buyerHandle: string, requested: ArrivalCursor | null) => {
      if (buyerHandle === "alice") return page([POST]);
      return requested ? page(secondPage) : page(firstPage, cursor);
    });
    view(loader, async () => [ALICE_SOURCE]);

    expect(await screen.findAllByTestId("arrival-post-card")).toHaveLength(100);
    expect(screen.getAllByTestId("arrival-account-group")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Load more posts" }));
    await waitFor(() => {
      expect(screen.getAllByTestId("arrival-post-card")).toHaveLength(105);
    });
    expect(screen.getAllByTestId("arrival-account-group")).toHaveLength(1);
    expect(loader).toHaveBeenLastCalledWith("", cursor);

    fireEvent.click(accountList().getByRole("button", { name: /@alice_shop/ }));
    await waitFor(() => {
      expect(screen.getAllByTestId("arrival-post-card")).toHaveLength(1);
    });
    expect(screen.queryByRole("button", { name: "Load more posts" })).toBeNull();
    expect(loader).toHaveBeenLastCalledWith("alice", null);
  });

  it("keeps loaded rows and the cursor through visible session recovery", async () => {
    const cursor = {
      before: POST.tweet_created_at!,
      before_key: POST.arrival_key,
    };
    const loader = vi.fn()
      .mockResolvedValueOnce(page([POST], cursor))
      .mockRejectedValueOnce(new ArrivalPostsRequestError(401, "Unauthorized"))
      .mockResolvedValueOnce(page([{ ...POST, arrival_key: "alice_shop:next", tweet_id: "next" }]));
    view(loader);

    expect(await screen.findAllByTestId("arrival-post-card")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Load more posts" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Your session ended");
    expect(screen.getAllByTestId("arrival-post-card")).toHaveLength(1);
    const signIn = screen.getByRole("link", { name: "Sign in again" });
    expect(signIn.getAttribute("href")).toBe("/login");
    expect(signIn.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("button", { name: "Load more posts" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Continue after signing in" }));
    await waitFor(() => {
      expect(screen.getAllByTestId("arrival-post-card")).toHaveLength(2);
    });
    expect(loader).toHaveBeenLastCalledWith("", cursor);
  });

  it("lists accounts newest first with the handle, the label when curated, and both counts", async () => {
    view(vi.fn(async () => page([])), async () => [ALICE_SOURCE, BOB_SOURCE]);

    await screen.findByText("No arrival posts found");
    const buttons = await waitFor(() => {
      const found = accountList().getAllByRole("button");
      expect(found).toHaveLength(3);
      return found;
    });
    expect(buttons[0].textContent).toContain("All accounts");
    expect(buttons[0].textContent).toContain("3 in 24 h");
    expect(buttons[0].textContent).toContain("49 posts");
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(buttons[1].textContent).toContain("@bob_shop");
    expect(buttons[1].textContent).not.toContain("Bob");
    expect(buttons[1].textContent).toContain("0 in 24 h");
    expect(buttons[1].textContent).toContain("7 posts");
    expect(buttons[2].textContent).toContain("@alice_shop");
    expect(buttons[2].textContent).toContain("Alice");
    expect(buttons[2].textContent).toContain("3 in 24 h");
    expect(buttons[2].textContent).toContain("42 posts");
    expect(screen.queryByTestId("arrival-accounts-fallback-note")).toBeNull();
  });

  it("derives the account list from loaded posts while the backend summary is missing", async () => {
    const now = Date.now();
    const hoursAgo = (hours: number) => new Date(now - hours * 60 * 60 * 1000).toISOString();
    const recentAlice = { ...POST, arrival_key: "alice_shop:recent", tweet_created_at: hoursAgo(1), acquired_at: hoursAgo(1) };
    const oldAlice = { ...POST, arrival_key: "alice_shop:old", tweet_created_at: hoursAgo(72), acquired_at: hoursAgo(72) };
    const recentBob = { ...BOB_POST, tweet_created_at: hoursAgo(2), acquired_at: hoursAgo(2) };
    const loader = vi.fn(async (buyerHandle: string) => page(
      buyerHandle === "alice" ? [recentAlice, oldAlice] : [recentAlice, recentBob, oldAlice],
    ));
    view(loader, async () => null);

    expect(await screen.findAllByTestId("arrival-post-card")).toHaveLength(3);
    expect(screen.getByTestId("arrival-accounts-fallback-note").textContent).toContain("posts loaded here");
    const buttons = accountList().getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      expect.stringContaining("All accounts"),
      expect.stringContaining("@alice_shop"),
      expect.stringContaining("@bob_shop"),
    ]);
    expect(buttons[0].textContent).toContain("2 in 24 h");
    expect(buttons[0].textContent).toContain("3 posts");
    expect(buttons[1].textContent).toContain("1 in 24 h");
    expect(buttons[1].textContent).toContain("2 posts");
    expect(buttons[2].textContent).toContain("1 in 24 h");
    expect(buttons[2].textContent).toContain("1 post");
    expect(buttons[2].textContent).not.toContain("1 posts");

    // A selection narrows the feed but never shrinks the derived list.
    fireEvent.click(buttons[1]);
    await waitFor(() => {
      expect(screen.getAllByTestId("arrival-post-card")).toHaveLength(2);
    });
    expect(loader).toHaveBeenLastCalledWith("alice", null);
    expect(accountList().getByRole("button", { name: /@bob_shop/ })).toBeTruthy();
    expect(accountList().getByRole("button", { name: /@alice_shop/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("hydrates the selection from ?shop=, filters server-side, and writes the selection back to the URL", async () => {
    window.history.replaceState(null, "", "/dashboard?view=arrivals&shop=alice");
    const loader = vi.fn(async () => page([]));
    view(loader, async () => [ALICE_SOURCE, BOB_SOURCE]);

    await screen.findByText("No arrival posts found");
    expect(loader).toHaveBeenNthCalledWith(1, "alice", null);
    await waitFor(() => {
      expect(accountList().getByRole("button", { name: /@alice_shop/ }).getAttribute("aria-pressed")).toBe("true");
    });
    expect(screen.getByText("Showing posts from")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Group by account" })).toBeNull();

    fireEvent.click(accountList().getByRole("button", { name: /@bob_shop/ }));
    await waitFor(() => {
      expect(loader).toHaveBeenLastCalledWith("bob", null);
    });
    // The remembered All window rides along as ?since=all; the shop keeps its place.
    expect(window.location.search).toBe("?view=arrivals&shop=bob&since=all");
    expect(accountList().getByRole("button", { name: /@bob_shop/ }).getAttribute("aria-pressed")).toBe("true");
    expect(accountList().getByRole("button", { name: /@alice_shop/ }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Show all accounts" }));
    await waitFor(() => {
      expect(loader).toHaveBeenLastCalledWith("", null);
    });
    expect(window.location.search).toBe("?view=arrivals&since=all");
    expect(screen.getByRole("button", { name: "Group by account" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("ignores a malformed ?shop= instead of sending it to the server", async () => {
    window.history.replaceState(null, "", `/dashboard?view=arrivals&shop=${"a".repeat(101)}`);
    const loader = vi.fn(async () => page([POST]));
    view(loader);

    expect(await screen.findAllByTestId("arrival-post-card")).toHaveLength(1);
    expect(loader).toHaveBeenLastCalledWith("", null);
    expect(window.location.search).toBe("?view=arrivals&since=all");
  });

  it("groups the All view by account newest first, collapses per account, and remembers both choices", async () => {
    const olderAlice = {
      ...POST,
      arrival_key: "alice_shop:older",
      tweet_id: "0",
      tweet_created_at: "2026-10-20T08:00:00+09:00",
      acquired_at: "2026-10-20T08:01:00+09:00",
    };
    const loader = vi.fn(async () => page([POST, BOB_POST, olderAlice]));
    const sources = async () => [ALICE_SOURCE, BOB_SOURCE];
    const { unmount } = view(loader, sources);

    const groups = await screen.findAllByTestId("arrival-account-group");
    expect(groups).toHaveLength(2);
    const aliceHeader = within(groups[0]).getByRole("button", { name: /@alice_shop/ });
    const bobHeader = within(groups[1]).getByRole("button", { name: /@bob_shop/ });
    expect(aliceHeader.textContent).toContain("Alice");
    expect(aliceHeader.textContent).toContain("2 loaded");
    expect(aliceHeader.textContent).toContain("Oct 20, 2026, 10:15 AM");
    expect(within(groups[0]).getAllByTestId("arrival-post-card")).toHaveLength(2);
    expect(within(groups[1]).getAllByTestId("arrival-post-card")).toHaveLength(1);
    expect(bobHeader.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(bobHeader);
    expect(bobHeader.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getAllByTestId("arrival-post-card")).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(COLLAPSED_ACCOUNTS_KEY)!)).toEqual(["bob"]);

    const toggle = screen.getByRole("button", { name: "Group by account" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryAllByTestId("arrival-account-group")).toHaveLength(0);
    expect(screen.getAllByTestId("arrival-post-card")).toHaveLength(3);
    expect(localStorage.getItem(GROUP_BY_ACCOUNT_KEY)).toBe("0");

    unmount();
    view(loader, sources);
    expect(await screen.findAllByTestId("arrival-post-card")).toHaveLength(3);
    expect(screen.queryAllByTestId("arrival-account-group")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Group by account" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Group by account" }));
    const regrouped = screen.getAllByTestId("arrival-account-group");
    expect(regrouped).toHaveLength(2);
    expect(within(regrouped[1]).getByRole("button", { name: /@bob_shop/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getAllByTestId("arrival-post-card")).toHaveLength(2);
  });

  it("keeps an account-summary failure non-fatal and retryable", async () => {
    const sourcesLoader = vi.fn<ArrivalSourcesLoader>()
      .mockRejectedValueOnce(new Error("summary fixture failure"))
      .mockResolvedValueOnce([ALICE_SOURCE]);
    view(vi.fn(async () => page([POST])), sourcesLoader);

    expect(await screen.findAllByTestId("arrival-post-card")).toHaveLength(1);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Account list could not be loaded");
    expect(alert.textContent).toContain("summary fixture failure");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(accountList().getByRole("button", { name: /@alice_shop/ })).toBeTruthy();
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("tucks the account list behind an expanded toggle on a phone and closes it on selection", async () => {
    view(vi.fn(async () => page([POST])), async () => [ALICE_SOURCE]);

    expect(await screen.findAllByTestId("arrival-post-card")).toHaveLength(1);
    const toggle = screen.getByRole("button", { name: "Show accounts" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const list = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(list.className).toContain("hidden");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toContain("Hide accounts");
    expect(list.className).not.toContain("hidden");

    fireEvent.click(accountList().getByRole("button", { name: /@alice_shop/ }));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("filters the account list by handle or curated label", async () => {
    view(vi.fn(async () => page([])), async () => [ALICE_SOURCE, BOB_SOURCE]);

    await waitFor(() => {
      expect(accountList().getAllByRole("button")).toHaveLength(3);
    });
    const search = screen.getByLabelText("Find account");
    fireEvent.change(search, { target: { value: "Ali" } });
    expect(accountList().getAllByRole("button").map((button) => button.textContent)).toEqual([
      expect.stringContaining("All accounts"),
      expect.stringContaining("@alice_shop"),
    ]);
    fireEvent.change(search, { target: { value: "@bob" } });
    expect(accountList().getByRole("button", { name: /@bob_shop/ })).toBeTruthy();
    expect(accountList().queryByRole("button", { name: /@alice_shop/ })).toBeNull();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No account matches this search.")).toBeTruthy();
    expect(accountList().getAllByRole("button")).toHaveLength(1);
  });
});

describe("ArrivalPostsView time window", () => {
  // Relative to the clock, because the window is.
  const now = Date.now();
  const hoursAgo = (hours: number) => new Date(now - hours * 60 * 60 * 1000).toISOString();
  const recentAlice: ArrivalPost = {
    ...POST,
    arrival_key: "alice_shop:recent",
    tweet_id: "recent",
    tweet_created_at: hoursAgo(1),
    acquired_at: hoursAgo(1),
  };
  const yesterdayBob: ArrivalPost = {
    ...BOB_POST,
    arrival_key: "bob_shop:yesterday",
    tweet_id: "yesterday",
    tweet_created_at: hoursAgo(30),
    acquired_at: hoursAgo(30),
  };
  const oldCarol: ArrivalPost = {
    ...POST,
    arrival_key: "carol_shop:old",
    buyer_handle: "carol",
    twitter_handle: "carol_shop",
    tweet_id: "old",
    tweet_url: "https://x.com/carol_shop/status/old",
    tweet_created_at: hoursAgo(72),
    acquired_at: hoursAgo(72),
  };
  const CAROL_SOURCE: ArrivalSource = {
    buyer_handle: "carol",
    twitter_handle: "carol_shop",
    post_count: 5,
    recent_count: 0,
    latest_post_at: hoursAgo(72),
  };
  const everyone: ArrivalSourcesLoader = async () => [ALICE_SOURCE, BOB_SOURCE, CAROL_SOURCE];

  // The cutoff the view sent to the account summary, within a minute of the expected one.
  function expectSinceNear(since: string | null | undefined, hours: number) {
    expect(since).toEqual(expect.any(String));
    expect(Math.abs(Date.parse(since!) - (now - hours * 60 * 60 * 1000))).toBeLessThan(60_000);
  }

  it("shows the last 48 hours by default, drops older rows, stops paging past the cutoff, and sends the cutoff to the account summary", async () => {
    const cursor: ArrivalCursor = { before: oldCarol.tweet_created_at!, before_key: oldCarol.arrival_key };
    const loader = vi.fn(async () => page([recentAlice, yesterdayBob, oldCarol], cursor));
    const sourcesLoader = vi.fn<ArrivalSourcesLoader>(everyone);
    view(loader, sourcesLoader);

    expect(await screen.findAllByTestId("arrival-post-card")).toHaveLength(2);
    expect(windowChip("48 h").getAttribute("aria-pressed")).toBe("true");
    expect(window.location.search).toBe("?view=arrivals");
    expect(screen.getByText("2 posts loaded")).toBeTruthy();
    // Carol's only post is outside the window, so she has no section; the panel still lists her.
    expect(screen.getAllByTestId("arrival-account-group").map((group) => group.textContent)).toEqual([
      expect.stringContaining("@alice_shop"),
      expect.stringContaining("@bob_shop"),
    ]);
    const carol = accountList().getByRole("button", { name: /@carol_shop/ });
    expect(carol.textContent).toContain("0 in 48 h");
    expect(carol.textContent).toContain("5 posts");
    // The page ended past the cutoff, so nothing newer is left to page to.
    expect(screen.queryByRole("button", { name: "Load more posts" })).toBeNull();
    expectSinceNear(sourcesLoader.mock.calls[0][0], 48);

    fireEvent.click(windowChip("24 h"));
    await waitFor(() => {
      expect(loader).toHaveBeenCalledTimes(2);
      expect(screen.getAllByTestId("arrival-post-card")).toHaveLength(1);
    });
    expect(windowChip("24 h").getAttribute("aria-pressed")).toBe("true");
    expect(window.location.search).toBe("?view=arrivals&since=24h");
    expect(localStorage.getItem(ARRIVALS_WINDOW_KEY)).toBe("24h");
    expect(screen.getAllByTestId("arrival-account-group")).toHaveLength(1);
    expectSinceNear(sourcesLoader.mock.calls.at(-1)?.[0], 24);
    await waitFor(() => {
      expect(accountList().getByRole("button", { name: /@alice_shop/ }).textContent).toContain("3 in 24 h");
    });
  });

  it("keeps Load more while a page ends inside the window and drops it once a page crosses the cutoff", async () => {
    const secondAlice: ArrivalPost = {
      ...recentAlice,
      arrival_key: "alice_shop:second",
      tweet_id: "second",
      tweet_created_at: hoursAgo(2),
      acquired_at: hoursAgo(2),
    };
    const firstCursor: ArrivalCursor = { before: secondAlice.tweet_created_at!, before_key: secondAlice.arrival_key };
    const secondCursor: ArrivalCursor = { before: oldCarol.tweet_created_at!, before_key: oldCarol.arrival_key };
    const loader = vi.fn(async (_buyerHandle: string, requested: ArrivalCursor | null) => (
      requested ? page([yesterdayBob, oldCarol], secondCursor) : page([recentAlice, secondAlice], firstCursor)
    ));
    view(loader, everyone);

    expect(await screen.findAllByTestId("arrival-post-card")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Load more posts" }));
    await waitFor(() => {
      expect(screen.getAllByTestId("arrival-post-card")).toHaveLength(3);
    });
    expect(loader).toHaveBeenLastCalledWith("", firstCursor);
    expect(screen.queryByRole("button", { name: "Load more posts" })).toBeNull();
    expect(screen.getAllByTestId("arrival-account-group")).toHaveLength(2);
  });

  it("names the window in the empty state and offers Show all when the selection has older posts", async () => {
    // Nothing at all is the plain empty state, in any window.
    const { unmount } = view(vi.fn(async () => page([])), everyone);
    expect((await screen.findByTestId("arrival-empty")).textContent).toContain("No arrival posts found");
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
    unmount();

    const loader = vi.fn(async (buyerHandle: string) => page(buyerHandle === "alice" ? [] : [oldCarol]));
    const sourcesLoader = vi.fn<ArrivalSourcesLoader>(everyone);
    view(loader, sourcesLoader);

    const empty = await screen.findByTestId("arrival-empty");
    expect(empty.textContent).toContain("No arrival posts in the last 48 hours");
    expect(empty.textContent).toContain("older posts outside the window");
    expect(screen.queryByRole("button", { name: "Load more posts" })).toBeNull();

    fireEvent.click(within(empty).getByRole("button", { name: "Show all" }));
    expect(await screen.findAllByTestId("arrival-post-card")).toHaveLength(1);
    expect(windowChip("All").getAttribute("aria-pressed")).toBe("true");
    expect(window.location.search).toBe("?view=arrivals&since=all");
    expect(localStorage.getItem(ARRIVALS_WINDOW_KEY)).toBe("all");
    // All leaves the summary's own 24-hour recent count in place, and says so.
    expect(sourcesLoader).toHaveBeenLastCalledWith(null);
    await waitFor(() => {
      expect(accountList().getByRole("button", { name: /@carol_shop/ }).textContent).toContain("0 in 24 h");
    });

    // A selection with no posts in any window is the plain empty state again.
    fireEvent.click(accountList().getByRole("button", { name: /@alice_shop/ }));
    await waitFor(() => {
      expect(screen.getByTestId("arrival-empty").textContent).toContain("No arrival posts found");
    });
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
  });

  it("treats a re-posted arrival as current for the window and the order, and says when and how it was re-posted", async () => {
    const boostedCarol: ArrivalPost = {
      ...oldCarol,
      arrival_key: "carol_shop:boosted",
      tweet_id: "boosted",
      last_boosted_at: hoursAgo(3),
      boost_count: 3,
      via_retweet_of: "dave_shop",
    };
    const onceBob: ArrivalPost = { ...yesterdayBob, last_boosted_at: hoursAgo(0.5), boost_count: 1 };
    // The backend orders by the re-posted time, so this is the order a page arrives in.
    const cursor: ArrivalCursor = { before: oldCarol.tweet_created_at!, before_key: oldCarol.arrival_key };
    const loader = vi.fn(async () => page([onceBob, recentAlice, boostedCarol, oldCarol], cursor));
    view(loader, everyone);

    const cards = await screen.findAllByTestId("arrival-post-card");
    // Carol's 72-hour-old post was re-posted 3 hours ago, so it is inside the 48-hour window.
    expect(cards).toHaveLength(3);
    expect(screen.getAllByTestId("arrival-account-group").map((group) => group.textContent)).toEqual([
      expect.stringContaining("@bob_shop"),
      expect.stringContaining("@alice_shop"),
      expect.stringContaining("@carol_shop"),
    ]);
    expect(screen.queryByRole("button", { name: "Load more posts" })).toBeNull();
    expect(screen.getAllByTestId("arrival-reposted").map((badge) => badge.textContent)).toEqual([
      "Re-posted 30 minutes ago",
      "Re-posted 3 times, last 3 hours ago",
    ]);
    expect(screen.getByTestId("arrival-via").textContent).toBe("via @dave_shop");
    expect(within(cards[1]).queryByTestId("arrival-reposted")).toBeNull();
    expect(within(cards[1]).queryByTestId("arrival-via")).toBeNull();
  });

  it("hydrates the window from ?since=, labels the counts with it, and otherwise applies the remembered choice", async () => {
    window.history.replaceState(null, "", "/dashboard?view=arrivals&since=7d");
    const loader = vi.fn(async () => page([recentAlice, yesterdayBob, oldCarol]));
    const sourcesLoader = vi.fn<ArrivalSourcesLoader>(everyone);
    const { unmount } = view(loader, sourcesLoader);

    expect(await screen.findAllByTestId("arrival-post-card")).toHaveLength(3);
    expect(windowChip("7 days").getAttribute("aria-pressed")).toBe("true");
    expect(window.location.search).toBe("?view=arrivals&since=7d");
    expectSinceNear(sourcesLoader.mock.calls[0][0], 7 * 24);
    await waitFor(() => {
      expect(accountList().getByRole("button", { name: /@alice_shop/ }).textContent).toContain("3 in 7 days");
    });
    expect(screen.getAllByTestId("arrival-account-group")).toHaveLength(3);
    // A link does not overwrite the viewer's remembered choice.
    expect(localStorage.getItem(ARRIVALS_WINDOW_KEY)).toBeNull();
    unmount();

    // A window the tab does not offer is ignored in favour of the remembered one.
    localStorage.setItem(ARRIVALS_WINDOW_KEY, "24h");
    window.history.replaceState(null, "", "/dashboard?view=arrivals&since=3d");
    view(loader, sourcesLoader);

    expect(await screen.findAllByTestId("arrival-post-card")).toHaveLength(1);
    expect(windowChip("24 h").getAttribute("aria-pressed")).toBe("true");
    expect(window.location.search).toBe("?view=arrivals&since=24h");
  });
});
