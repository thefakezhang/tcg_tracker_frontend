import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COLLAPSED_ACCOUNTS_KEY,
  GROUP_BY_ACCOUNT_KEY,
  type ArrivalAccountPost,
  accountLabel,
  deriveArrivalSources,
  groupPostsByAccount,
  matchesAccountQuery,
  parseArrivalSources,
  postObservedAt,
  readCollapsedAccounts,
  readGroupByAccount,
  sortArrivalSources,
  writeCollapsedAccounts,
  writeGroupByAccount,
} from "./arrival-accounts";

const NOW = Date.parse("2026-10-21T12:00:00+09:00");
const HOUR = 60 * 60 * 1000;

function post(
  key: string,
  buyer: string,
  handle: string,
  createdAt: string | null,
  acquiredAt = "2026-10-21T11:59:00+09:00",
): ArrivalAccountPost {
  return {
    arrival_key: key,
    buyer_handle: buyer,
    twitter_handle: handle,
    tweet_created_at: createdAt,
    acquired_at: acquiredAt,
  };
}

function at(hoursAgo: number): string {
  return new Date(NOW - hoursAgo * HOUR).toISOString();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseArrivalSources", () => {
  it("accepts the backend summary rows, including counts PostgREST serialises as strings", () => {
    expect(parseArrivalSources([
      { buyer_handle: "alice", twitter_handle: "alice_shop", post_count: 42, recent_count: "3", latest_post_at: "2026-10-20T01:15:00Z" },
      { buyer_handle: "bob", twitter_handle: "bob_shop", post_count: 0, recent_count: 0, latest_post_at: null },
    ])).toEqual([
      { buyer_handle: "alice", twitter_handle: "alice_shop", post_count: 42, recent_count: 3, latest_post_at: "2026-10-20T01:15:00Z" },
      { buyer_handle: "bob", twitter_handle: "bob_shop", post_count: 0, recent_count: 0, latest_post_at: null },
    ]);
  });

  it("fails closed on a malformed row", () => {
    const row = { buyer_handle: "alice", twitter_handle: "alice_shop", post_count: 1, recent_count: 0, latest_post_at: null };
    expect(() => parseArrivalSources({})).toThrow("Invalid arrival sources response");
    expect(() => parseArrivalSources([{ ...row, buyer_handle: "" }])).toThrow("buyer_handle");
    expect(() => parseArrivalSources([{ ...row, twitter_handle: 7 }])).toThrow("twitter_handle");
    expect(() => parseArrivalSources([{ ...row, post_count: -1 }])).toThrow("post_count");
    expect(() => parseArrivalSources([{ ...row, recent_count: 1.5 }])).toThrow("recent_count");
    expect(() => parseArrivalSources([{ ...row, latest_post_at: "yesterday" }])).toThrow("timestamp");
  });
});

describe("deriveArrivalSources", () => {
  it("counts every seen post per account, the recent ones within 24 hours, newest account first", () => {
    const sources = deriveArrivalSources([
      post("alice:1", "alice", "alice_shop", at(30)),
      post("bob:1", "bob", "bob_shop", at(2)),
      post("alice:2", "alice", "alice_shop", at(1)),
      post("alice:3", "alice", "alice_shop", at(23.5)),
      post("carol:1", "carol", "carol_shop", null, at(5)),
    ], NOW);

    expect(sources).toEqual([
      { buyer_handle: "alice", twitter_handle: "alice_shop", post_count: 3, recent_count: 2, latest_post_at: at(1) },
      { buyer_handle: "bob", twitter_handle: "bob_shop", post_count: 1, recent_count: 1, latest_post_at: at(2) },
      { buyer_handle: "carol", twitter_handle: "carol_shop", post_count: 1, recent_count: 1, latest_post_at: at(5) },
    ]);
  });

  it("counts recent posts from an explicit cutoff when the tab's window is not 24 hours", () => {
    const [source] = deriveArrivalSources([
      post("alice:1", "alice", "alice_shop", at(30)),
      post("alice:2", "alice", "alice_shop", at(47)),
      post("alice:3", "alice", "alice_shop", at(48)),
      post("alice:4", "alice", "alice_shop", at(49)),
    ], NOW, NOW - 48 * HOUR);

    expect(source.post_count).toBe(4);
    expect(source.recent_count).toBe(3);
  });

  it("takes the handle from the newest post when a shop was renamed", () => {
    const [source] = deriveArrivalSources([
      post("alice:1", "alice", "alice_old", at(40)),
      post("alice:2", "alice", "alice_shop", at(3)),
    ], NOW);
    expect(source.twitter_handle).toBe("alice_shop");
  });

  it("sorts accounts without a usable timestamp last and ties by shop id", () => {
    expect(sortArrivalSources([
      { buyer_handle: "zed", twitter_handle: "z", post_count: 1, recent_count: 0, latest_post_at: null },
      { buyer_handle: "bob", twitter_handle: "b", post_count: 1, recent_count: 0, latest_post_at: at(1) },
      { buyer_handle: "alice", twitter_handle: "a", post_count: 1, recent_count: 0, latest_post_at: at(1) },
      { buyer_handle: "dan", twitter_handle: "d", post_count: 1, recent_count: 0, latest_post_at: "not a time" },
    ]).map((source) => source.buyer_handle)).toEqual(["alice", "bob", "dan", "zed"]);
  });
});

describe("postObservedAt", () => {
  it("is the tweet time, else the collection time, lifted to a later re-post", () => {
    const base = post("alice:1", "alice", "alice_shop", at(72));
    expect(postObservedAt(base)).toBe(at(72));
    expect(postObservedAt(post("alice:2", "alice", "alice_shop", null, at(5)))).toBe(at(5));
    expect(postObservedAt({ ...base, last_boosted_at: at(3) })).toBe(at(3));
    // A re-post that is not later, or not readable, changes nothing.
    expect(postObservedAt({ ...base, last_boosted_at: at(100) })).toBe(at(72));
    expect(postObservedAt({ ...base, last_boosted_at: "not a time" })).toBe(at(72));
    expect(postObservedAt({ ...base, last_boosted_at: null })).toBe(at(72));
  });

  it("counts and orders re-posted rows by their re-post", () => {
    const [source] = deriveArrivalSources([
      post("alice:1", "alice", "alice_shop", at(72)),
      { ...post("alice:2", "alice", "alice_shop", at(80)), last_boosted_at: at(2) },
    ], NOW);
    expect(source.recent_count).toBe(1);
    expect(source.latest_post_at).toBe(at(2));

    const groups = groupPostsByAccount([
      post("bob:1", "bob", "bob_shop", at(10)),
      { ...post("alice:1", "alice", "alice_shop", at(72)), last_boosted_at: at(1) },
    ]);
    expect(groups.map((group) => group.buyer_handle)).toEqual(["alice", "bob"]);
    expect(groups[0].latest_post_at).toBe(at(1));
  });
});

describe("groupPostsByAccount", () => {
  it("orders groups by their newest post and keeps each account's posts in feed order", () => {
    const groups = groupPostsByAccount([
      post("alice:2", "alice", "alice_shop", at(1)),
      post("bob:1", "bob", "bob_shop", at(2)),
      post("alice:1", "alice", "alice_shop", at(30)),
      post("carol:1", "carol", "carol_shop", at(0.5)),
    ]);

    expect(groups.map((group) => group.buyer_handle)).toEqual(["carol", "alice", "bob"]);
    expect(groups[1].posts.map((entry) => entry.arrival_key)).toEqual(["alice:2", "alice:1"]);
    expect(groups[1].latest_post_at).toBe(at(1));
    expect(groups[1].twitter_handle).toBe("alice_shop");
  });

  it("returns no groups for no posts", () => {
    expect(groupPostsByAccount([])).toEqual([]);
  });
});

describe("account identity and search", () => {
  it("has a label only for shops curated in source-labels", () => {
    expect(accountLabel("alice")).toBe("Alice");
    expect(accountLabel("some_new_shop")).toBeNull();
  });

  it("matches the handle, the shop id, or the label, ignoring case and a leading @", () => {
    const alice = { buyer_handle: "alice", twitter_handle: "alice_shop", post_count: 1, recent_count: 0, latest_post_at: null };
    const bob = { buyer_handle: "bob", twitter_handle: "bob_shop", post_count: 1, recent_count: 0, latest_post_at: null };
    expect(matchesAccountQuery(alice, "")).toBe(true);
    expect(matchesAccountQuery(alice, "@ALICE_")).toBe(true);
    expect(matchesAccountQuery(alice, "Alice")).toBe(true);
    expect(matchesAccountQuery(bob, "alice")).toBe(false);
    expect(matchesAccountQuery(bob, " bob ")).toBe(true);
  });
});

describe("remembered preferences", () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial));
    return {
      store,
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    };
  }

  it("groups by account until the viewer turns it off, and forgets an empty collapsed set", () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);

    expect(readGroupByAccount()).toBe(true);
    writeGroupByAccount(false);
    expect(storage.getItem(GROUP_BY_ACCOUNT_KEY)).toBe("0");
    expect(readGroupByAccount()).toBe(false);

    writeCollapsedAccounts(new Set(["bob", "alice"]));
    expect(JSON.parse(storage.getItem(COLLAPSED_ACCOUNTS_KEY)!)).toEqual(["bob", "alice"]);
    expect(readCollapsedAccounts()).toEqual(new Set(["alice", "bob"]));
    writeCollapsedAccounts(new Set());
    expect(storage.getItem(COLLAPSED_ACCOUNTS_KEY)).toBeNull();
  });

  it("ignores a corrupt stored value", () => {
    vi.stubGlobal("localStorage", fakeStorage({ [COLLAPSED_ACCOUNTS_KEY]: "{not json" }));
    expect(readCollapsedAccounts()).toEqual(new Set());
    vi.stubGlobal("localStorage", fakeStorage({ [COLLAPSED_ACCOUNTS_KEY]: JSON.stringify([1, "alice", null]) }));
    expect(readCollapsedAccounts()).toEqual(new Set(["alice"]));
  });

  it("falls back to the defaults when storage throws or is absent", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    expect(readGroupByAccount()).toBe(true);
    expect(readCollapsedAccounts()).toEqual(new Set());
    expect(() => writeGroupByAccount(false)).not.toThrow();
    expect(() => writeCollapsedAccounts(new Set(["alice"]))).not.toThrow();

    vi.stubGlobal("localStorage", undefined);
    expect(readGroupByAccount()).toBe(true);
    expect(() => writeGroupByAccount(true)).not.toThrow();
  });
});
