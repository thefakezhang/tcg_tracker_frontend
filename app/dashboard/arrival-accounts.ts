// Pure account-level logic for the Arrivals tab: the account summary rows the
// backend RPC `twitter_arrival_sources` returns, the same summary derived from
// posts already loaded (the fallback while that RPC is not applied yet), the
// per-account grouping of the feed, and the per-viewer preferences that the
// view remembers in localStorage.
import { arrivalObservedAt } from "@/lib/arrival-observed-at";
import { readLocalStorage, writeLocalStorage } from "@/lib/local-storage";
import { sourceLabel } from "@/lib/source-labels";

/** The default window behind `recent_count`, the backend RPC's as well: posts observed in the last 24 hours. */
export const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export const GROUP_BY_ACCOUNT_KEY = "arrivals.groupByAccount";
export const COLLAPSED_ACCOUNTS_KEY = "arrivals.collapsedAccounts";

export type ArrivalSource = {
  buyer_handle: string;
  twitter_handle: string;
  post_count: number;
  recent_count: number;
  latest_post_at: string | null;
};

/** The post fields the account logic needs; `ArrivalPost` satisfies it. */
export type ArrivalAccountPost = {
  arrival_key: string;
  buyer_handle: string;
  twitter_handle: string;
  tweet_created_at: string | null;
  acquired_at: string;
  /** When the shop last re-surfaced the post by retweeting it; absent or null when never. */
  last_boosted_at?: string | null;
};

export type ArrivalAccountGroup<P extends ArrivalAccountPost> = {
  buyer_handle: string;
  twitter_handle: string;
  /** Observed time of the group's newest post. */
  latest_post_at: string;
  posts: P[];
};

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid arrival source field: ${field}`);
  }
  return value;
}

function requiredCount(value: unknown, field: string): number {
  const count = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(count) || Number(count) < 0) {
    throw new Error(`Invalid arrival source count: ${field}`);
  }
  return Number(count);
}

/** Validates the `/api/twitter-arrivals/sources` rows; fails closed on any malformed row. */
export function parseArrivalSources(value: unknown): ArrivalSource[] {
  if (!Array.isArray(value)) throw new Error("Invalid arrival sources response");
  return value.map((raw, index) => {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Invalid arrival source row: ${index}`);
    }
    const row = raw as Record<string, unknown>;
    const latest = row.latest_post_at ?? null;
    if (latest !== null && (typeof latest !== "string" || Number.isNaN(Date.parse(latest)))) {
      throw new Error(`Invalid arrival source timestamp: ${index}`);
    }
    return {
      buyer_handle: requiredString(row.buyer_handle, "buyer_handle"),
      twitter_handle: requiredString(row.twitter_handle, "twitter_handle"),
      post_count: requiredCount(row.post_count, "post_count"),
      recent_count: requiredCount(row.recent_count, "recent_count"),
      latest_post_at: latest,
    };
  });
}

/** The time a post is ordered by: when the shop posted it, else when it was collected, lifted to a later re-post. */
export function postObservedAt(post: ArrivalAccountPost): string {
  return arrivalObservedAt(post);
}

function epoch(value: string | null): number {
  if (value === null) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

// Newest first. Two unknown times are both -Infinity, and subtracting those is
// NaN, which a sort treats as "equal" without ever reaching the tiebreak; a
// comparison does not have that hole.
function newestFirst(a: number, b: number): number {
  if (a === b) return 0;
  return b > a ? 1 : -1;
}

/** Newest activity first; accounts without a timestamp last; ties by handle so the order is stable. */
export function sortArrivalSources(sources: readonly ArrivalSource[]): ArrivalSource[] {
  return [...sources].sort((a, b) => {
    const byTime = newestFirst(epoch(a.latest_post_at), epoch(b.latest_post_at));
    if (byTime !== 0) return byTime;
    return a.buyer_handle.localeCompare(b.buyer_handle);
  });
}

/**
 * The account summary computed from the posts seen so far, for use before the
 * backend RPC exists. Counts cover only those posts, which the view says.
 * `recent_count` counts posts observed at or after `recentSince` (the tab's
 * window cutoff); null means the RPC's own default, the last 24 hours.
 */
export function deriveArrivalSources(
  posts: Iterable<ArrivalAccountPost>,
  now: number,
  recentSince: number | null = null,
): ArrivalSource[] {
  const since = recentSince ?? now - RECENT_WINDOW_MS;
  const byAccount = new Map<string, ArrivalSource & { latestEpoch: number }>();
  for (const post of posts) {
    const observed = postObservedAt(post);
    const observedEpoch = epoch(observed);
    const current = byAccount.get(post.buyer_handle);
    const recent = observedEpoch >= since && observedEpoch <= now ? 1 : 0;
    if (!current) {
      byAccount.set(post.buyer_handle, {
        buyer_handle: post.buyer_handle,
        twitter_handle: post.twitter_handle,
        post_count: 1,
        recent_count: recent,
        latest_post_at: observedEpoch === Number.NEGATIVE_INFINITY ? null : observed,
        latestEpoch: observedEpoch,
      });
      continue;
    }
    current.post_count += 1;
    current.recent_count += recent;
    if (observedEpoch > current.latestEpoch) {
      current.latestEpoch = observedEpoch;
      current.latest_post_at = observed;
      // The handle a shop posts under can be renamed; the newest post has the current one.
      current.twitter_handle = post.twitter_handle;
    }
  }
  return sortArrivalSources(
    [...byAccount.values()].map(({ latestEpoch: _latestEpoch, ...source }) => source),
  );
}

/**
 * One group per account, ordered by each account's newest post. Posts keep
 * their input order, which the feed already has newest first.
 */
export function groupPostsByAccount<P extends ArrivalAccountPost>(
  posts: readonly P[],
): ArrivalAccountGroup<P>[] {
  const groups = new Map<string, ArrivalAccountGroup<P> & { latestEpoch: number }>();
  for (const post of posts) {
    const observed = postObservedAt(post);
    const observedEpoch = epoch(observed);
    const group = groups.get(post.buyer_handle);
    if (!group) {
      groups.set(post.buyer_handle, {
        buyer_handle: post.buyer_handle,
        twitter_handle: post.twitter_handle,
        latest_post_at: observed,
        latestEpoch: observedEpoch,
        posts: [post],
      });
      continue;
    }
    group.posts.push(post);
    if (observedEpoch > group.latestEpoch) {
      group.latestEpoch = observedEpoch;
      group.latest_post_at = observed;
      group.twitter_handle = post.twitter_handle;
    }
  }
  return [...groups.values()]
    .sort((a, b) => {
      const byTime = newestFirst(a.latestEpoch, b.latestEpoch);
      if (byTime !== 0) return byTime;
      return a.buyer_handle.localeCompare(b.buyer_handle);
    })
    .map(({ latestEpoch: _latestEpoch, ...group }) => group);
}

/**
 * The curated display name for a shop, or null when `lib/source-labels.ts` has
 * none. Most enrolled shops have no label, so the X handle stays the primary
 * identity and the label is only ever a secondary line.
 */
export function accountLabel(buyerHandle: string): string | null {
  const label = sourceLabel(buyerHandle);
  return label === buyerHandle ? null : label;
}

/** Case-insensitive match against the X handle, the shop id, and the curated label. */
export function matchesAccountQuery(source: ArrivalSource, query: string): boolean {
  const needle = query.trim().toLowerCase().replace(/^@/, "");
  if (needle === "") return true;
  return [source.twitter_handle, source.buyer_handle, accountLabel(source.buyer_handle) ?? ""]
    .some((field) => field.toLowerCase().includes(needle));
}

export function readGroupByAccount(): boolean {
  return readLocalStorage(GROUP_BY_ACCOUNT_KEY) !== "0";
}

export function writeGroupByAccount(enabled: boolean): void {
  writeLocalStorage(GROUP_BY_ACCOUNT_KEY, enabled ? "1" : "0");
}

export function readCollapsedAccounts(): Set<string> {
  const stored = readLocalStorage(COLLAPSED_ACCOUNTS_KEY);
  if (stored === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

export function writeCollapsedAccounts(collapsed: ReadonlySet<string>): void {
  writeLocalStorage(
    COLLAPSED_ACCOUNTS_KEY,
    collapsed.size === 0 ? null : JSON.stringify([...collapsed]),
  );
}
