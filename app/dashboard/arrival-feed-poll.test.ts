// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ArrivalAccountPost } from "./arrival-accounts";
import { captureScrollAnchor, mergeFreshPosts, restoreScrollAnchor } from "./arrival-feed-poll";

function post(key: string, createdAt: string, extra: Partial<ArrivalAccountPost> = {}): ArrivalAccountPost {
  return {
    arrival_key: key,
    buyer_handle: "bob",
    twitter_handle: "bob_shop",
    tweet_created_at: createdAt,
    acquired_at: createdAt,
    ...extra,
  };
}

describe("mergeFreshPosts", () => {
  const first = post("first", "2026-11-11T02:30:00Z");
  const older = post("older", "2026-11-11T01:30:00Z");

  it("puts new posts in above the loaded ones and drops nothing loaded", () => {
    const fresh = post("fresh", "2026-11-11T03:00:00Z");
    expect(mergeFreshPosts([first, older], [fresh, first]).map((item) => item.arrival_key))
      .toEqual(["fresh", "first", "older"]);
  });

  it("keeps the list newest first when a refresh brings a post older than the top", () => {
    const late = post("late", "2026-11-11T02:00:00Z");
    expect(mergeFreshPosts([first, older], [first, late]).map((item) => item.arrival_key))
      .toEqual(["first", "late", "older"]);
  });

  it("takes the refreshed copy of a loaded post, so a re-post moves it up", () => {
    const boosted = { ...older, last_boosted_at: "2026-11-11T02:45:00Z" };
    const merged = mergeFreshPosts([first, older], [boosted, first]);
    expect(merged.map((item) => item.arrival_key)).toEqual(["older", "first"]);
    expect(merged[0]).toBe(boosted);
  });

  it("returns the same list when the refresh brings nothing new, so nothing renders", () => {
    const known = [first, older];
    expect(mergeFreshPosts(known, [{ ...first }])).toBe(known);
    expect(mergeFreshPosts(known, [])).toBe(known);
  });

  it("puts new posts ahead of loaded ones with the same time, each once", () => {
    const twin = post("twin", first.tweet_created_at!);
    expect(mergeFreshPosts([first], [twin, twin, first]).map((item) => item.arrival_key)).toEqual(["twin", "first"]);
  });
});

describe("scroll anchor", () => {
  // jsdom lays nothing out, so each element's position is stubbed: `tops`
  // holds where every card and panel is now, and tests move them.
  let tops = new Map<Element, number>();
  const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const top = tops.get(this) ?? 0;
    return { top, bottom: top + 100, left: 0, right: 0, width: 0, height: 100, x: 0, y: top, toJSON: () => ({}) };
  });

  afterEach(() => {
    tops = new Map();
    document.body.innerHTML = "";
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });

  function card(key: string, parent: Element) {
    const element = document.createElement("div");
    element.dataset.arrivalKey = key;
    parent.append(element);
    return element;
  }

  it("keeps the first card in view where it was when posts are merged in above it", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const above = card("above", root);
    const reading = card("reading", root);
    tops.set(above, -150).set(reading, 40);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 600 });
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});

    const anchor = captureScrollAnchor(root);
    expect(anchor).toMatchObject({ key: "reading", top: 40, panelTop: null, pageScrolled: true });
    // Two new cards land above it and push it down by 260 px.
    tops.set(reading, 300);
    restoreScrollAnchor(root, anchor);
    expect(scrollBy).toHaveBeenCalledWith(0, 260);
    scrollBy.mockRestore();
  });

  it("leaves a reader at the very top where they are, so new posts simply appear", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const reading = card("reading", root);
    tops.set(reading, 40);
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});

    const anchor = captureScrollAnchor(root);
    tops.set(reading, 300);
    restoreScrollAnchor(root, anchor);
    expect(scrollBy).not.toHaveBeenCalled();
    scrollBy.mockRestore();
  });

  it("corrects the page for panels added above and the account panel for posts added inside it", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const panel = document.createElement("section");
    panel.setAttribute("data-arrival-scroll", "");
    root.append(panel);
    const hidden = card("hidden", panel);
    const reading = card("reading", panel);
    // The panel starts 100 px down the window and is scrolled: its first card is above its top.
    tops.set(panel, 100).set(hidden, -20).set(reading, 180);
    panel.scrollTop = 120;
    Object.defineProperty(window, "scrollY", { configurable: true, value: 400 });
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});

    const anchor = captureScrollAnchor(root);
    expect(anchor).toMatchObject({ key: "reading", top: 180, panelTop: 100, panelScrolled: true });
    // A new account panel above pushes this one down 300 px, and a new post inside it pushes the card 90 px further.
    tops.set(panel, 400).set(reading, 570);
    restoreScrollAnchor(root, anchor);
    expect(scrollBy).toHaveBeenCalledWith(0, 300);
    expect(panel.scrollTop).toBe(210);
    scrollBy.mockRestore();
  });

  it("does nothing without a card to hold on to", () => {
    const root = document.createElement("div");
    expect(captureScrollAnchor(root)).toBeNull();
    expect(captureScrollAnchor(null)).toBeNull();
    expect(() => restoreScrollAnchor(root, { key: "gone", top: 0, panelTop: null, pageScrolled: true, panelScrolled: false }))
      .not.toThrow();
    rect.mockClear();
  });
});
