// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider } from "./LanguageContext";
import ArrivalPostsView, { type ArrivalPost, parseArrivalPosts } from "./ArrivalPostsView";

const POST: ArrivalPost = {
  arrival_key: "alice_shop:2112064092735521045",
  buyer_handle: "alice",
  twitter_handle: "alice_shop",
  tweet_id: "2112064092735521045",
  tweet_url: "https://x.com/alice_shop/status/2112064092735521045",
  tweet_created_at: "2026-10-20T10:15:00+09:00",
  acquired_at: "2026-10-20T10:16:00+09:00",
  unverified: true,
  media: [{
    source_image_index: 0,
    source_image_url: "https://pbs.twimg.com/media/arrival.jpg",
    content_sha256: "a".repeat(64),
  }],
};

function view(loader: (buyerHandle: string) => Promise<ArrivalPost[]>) {
  return render(
    <LanguageProvider>
      <ArrivalPostsView loader={loader} />
    </LanguageProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ArrivalPostsView", () => {
  it("keeps a visible loading state until the post-level evidence arrives", async () => {
    let resolve!: (posts: ArrivalPost[]) => void;
    const loader = vi.fn(() => new Promise<ArrivalPost[]>((done) => { resolve = done; }));
    view(loader);

    expect(screen.getByRole("status").textContent).toContain("Loading arrival posts");
    await act(async () => resolve([]));
    expect(await screen.findByText("No arrival posts found")).toBeTruthy();
  });

  it("shows shop, post time, evidence images, source URL, and unverified scope", async () => {
    const other = {
      ...POST,
      arrival_key: "bob_shop:2",
      buyer_handle: "bob",
      twitter_handle: "bob_shop",
      tweet_id: "2",
      tweet_url: "https://x.com/bob_shop/status/2",
    };
    const loader = vi.fn(async (buyerHandle: string) => buyerHandle === "alice" ? [POST] : [POST, other]);
    view(loader);

    expect(await screen.findAllByTestId("arrival-post-card")).toHaveLength(2);
    expect(screen.getAllByText("Unverified post")).toHaveLength(2);
    expect(screen.getByText("@alice_shop · Oct 20, 2026, 10:15 AM")).toBeTruthy();
    const source = screen.getAllByRole("link", { name: "Open original post" })[0];
    expect(source.getAttribute("href")).toBe(POST.tweet_url);
    const media = screen.getAllByRole("link", { name: "Open original image 1" })[0];
    expect(media.getAttribute("href")).toBe(POST.media[0].source_image_url);
    expect(media.querySelector("img")?.className).toContain("object-contain");
    expect(media.querySelector("img")?.className).not.toContain("object-cover");
    expect(document.body.textContent).toContain("No item, grade, or price has been inferred");

    fireEvent.change(screen.getByLabelText("Shop account"), { target: { value: " alice " } });
    fireEvent.submit(screen.getByRole("button", { name: "Show posts" }).closest("form")!);
    expect(await screen.findAllByTestId("arrival-post-card")).toHaveLength(1);
    expect(loader).toHaveBeenLastCalledWith("alice");
  });

  it("renders a retryable error and recovers without stale rows", async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("temporary fixture failure"))
      .mockResolvedValueOnce([POST]);
    view(loader);

    expect((await screen.findByRole("alert")).textContent).toContain("temporary fixture failure");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("alice")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("fails closed on malformed or item-level responses", () => {
    expect(() => parseArrivalPosts([{ ...POST, unverified: false }])).toThrow("Invalid arrival evidence");
    expect(() => parseArrivalPosts([{ ...POST, media: [] }])).toThrow("Invalid arrival evidence");
    expect(() => parseArrivalPosts([{ ...POST, media: [{ ...POST.media[0], content_sha256: "bad" }] }])).toThrow("Invalid arrival media digest");
    expect(() => parseArrivalPosts([{ ...POST, price_jpy: 1000 }])).toThrow("Forbidden arrival field: price_jpy");
  });
});
