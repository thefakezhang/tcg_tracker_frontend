import { afterEach, describe, expect, it, vi } from "vitest";

import type { ArrivalAccountPost } from "./arrival-accounts";
import {
  ARRIVALS_WINDOW_KEY,
  MAX_WINDOW_PAGES,
  cutoffISO,
  pageExhaustsWindow,
  postsWithinWindow,
  readArrivalWindow,
  windowCutoff,
  windowMs,
  windowPagingContinues,
  withinWindow,
  writeArrivalWindow,
} from "./arrival-window";

const NOW = Date.parse("2026-10-24T12:00:00+09:00");
const HOUR = 60 * 60 * 1000;

function at(hoursAgo: number): string {
  return new Date(NOW - hoursAgo * HOUR).toISOString();
}

function post(key: string, createdAt: string | null, acquiredAt = at(0)): ArrivalAccountPost {
  return {
    arrival_key: key,
    buyer_handle: "alice",
    twitter_handle: "alice_shop",
    tweet_created_at: createdAt,
    acquired_at: acquiredAt,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("window cutoff", () => {
  it("measures each window back from now, and All has no cutoff", () => {
    expect(windowMs("24h")).toBe(24 * HOUR);
    expect(windowMs("48h")).toBe(48 * HOUR);
    expect(windowMs("7d")).toBe(7 * 24 * HOUR);
    expect(windowMs("all")).toBeNull();
    expect(windowCutoff("48h", NOW)).toBe(NOW - 48 * HOUR);
    expect(windowCutoff("all", NOW)).toBeNull();
    expect(cutoffISO(windowCutoff("24h", NOW))).toBe("2026-10-23T03:00:00.000Z");
    expect(cutoffISO(null)).toBeNull();
  });
});

describe("postsWithinWindow", () => {
  const cutoff = NOW - 48 * HOUR;

  it("keeps posts observed at or after the cutoff, by tweet time else collection time", () => {
    const inside = post("inside", at(47.9));
    const boundary = post("boundary", at(48));
    const outside = post("outside", at(48.1));
    const collectedInside = post("collected", null, at(1));
    const collectedOutside = post("collected-old", null, at(72));

    expect(
      postsWithinWindow([inside, boundary, outside, collectedInside, collectedOutside], cutoff)
        .map((entry) => entry.arrival_key),
    ).toEqual(["inside", "boundary", "collected"]);
    // An unreadable time sorts oldest in the feed, so it is outside the window too.
    expect(withinWindow(post("unreadable", "yesterday-ish"), cutoff)).toBe(false);
  });

  it("counts a re-posted row by its latest re-post", () => {
    const boosted = { ...post("boosted", at(72)), last_boosted_at: at(3) };
    expect(withinWindow(boosted, cutoff)).toBe(true);
    expect(postsWithinWindow([boosted, post("old", at(72))], cutoff).map((entry) => entry.arrival_key)).toEqual(["boosted"]);
    // A page ending on a re-posted row is still inside the window.
    expect(pageExhaustsWindow([post("a", at(1)), boosted], cutoff)).toBe(false);
  });

  it("shows everything for All, without copying", () => {
    const posts = [post("a", at(1)), post("b", at(500))];
    expect(postsWithinWindow(posts, null)).toBe(posts);
  });
});

describe("pageExhaustsWindow", () => {
  const cutoff = NOW - 48 * HOUR;

  it("stops paging once a newest-first page ends past the cutoff", () => {
    expect(pageExhaustsWindow([post("a", at(1)), post("b", at(47))], cutoff)).toBe(false);
    expect(pageExhaustsWindow([post("a", at(1)), post("b", at(49))], cutoff)).toBe(true);
    // The boundary itself is still inside, so a page ending there may continue.
    expect(pageExhaustsWindow([post("b", at(48))], cutoff)).toBe(false);
  });

  it("never stops for All or for an empty page", () => {
    expect(pageExhaustsWindow([post("a", at(900))], null)).toBe(false);
    expect(pageExhaustsWindow([], cutoff)).toBe(false);
  });
});

describe("windowPagingContinues", () => {
  const cutoff = NOW - 48 * HOUR;
  const cursor = { before: at(1), before_key: "alice:1" };

  it("follows the cursor of a finite window until the bound, and never for All or at the end", () => {
    expect(windowPagingContinues(cutoff, cursor, 1)).toBe(true);
    expect(windowPagingContinues(cutoff, cursor, MAX_WINDOW_PAGES - 1)).toBe(true);
    expect(windowPagingContinues(cutoff, cursor, MAX_WINDOW_PAGES)).toBe(false);
    expect(windowPagingContinues(cutoff, null, 1)).toBe(false);
    expect(windowPagingContinues(null, cursor, 1)).toBe(false);
  });
});

describe("remembered window", () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    };
  }

  it("defaults to 48 hours and remembers the viewer's choice", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);

    expect(readArrivalWindow()).toBe("48h");
    writeArrivalWindow("7d");
    expect(storage.getItem(ARRIVALS_WINDOW_KEY)).toBe("7d");
    expect(readArrivalWindow()).toBe("7d");
  });

  it("ignores a stored window the tab does not offer, and a blocked or absent storage", () => {
    vi.stubGlobal("localStorage", fakeStorage({ [ARRIVALS_WINDOW_KEY]: "3d" }));
    expect(readArrivalWindow()).toBe("48h");

    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    expect(readArrivalWindow()).toBe("48h");
    expect(() => writeArrivalWindow("24h")).not.toThrow();

    vi.stubGlobal("localStorage", undefined);
    expect(readArrivalWindow()).toBe("48h");
    expect(() => writeArrivalWindow("all")).not.toThrow();
  });
});
