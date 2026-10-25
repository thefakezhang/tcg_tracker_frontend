// The time window of the Arrivals tab. Arrival posts are time-sensitive (a
// stock photo from four days ago is almost never stock today), so the tab shows
// the last 48 hours by default and offers 24 hours, 7 days, and All. Nothing is
// deleted: the posts are evidence, and All still shows every one of them.
//
// The window's cutoff goes to both backend RPCs as p_since (inclusive), so the
// posts RPC returns only rows observed inside the window and the account
// summary counts the same rows. The feed still applies the cutoff to the rows
// it receives: the RPC orders newest first by observed time (tweet_created_at,
// else acquired_at, lifted to a later re-post), so dropping older rows is
// exact, and once a page's last row is older than the cutoff every row a later
// page could return is older too, so paging stops there as well.
//
// A finite window is loaded whole: the feed follows the cursor page after page
// until the window is exhausted, so an account's section shows every post it
// made in the window, not the ones that happened to land in the first page.
// MAX_WINDOW_PAGES bounds one such run; past it the viewer continues by hand.
import { readLocalStorage, writeLocalStorage } from "@/lib/local-storage";
import { type ArrivalAccountPost, postObservedAt } from "./arrival-accounts";
import { type ArrivalWindow, DEFAULT_ARRIVAL_WINDOW, parseWindowParam } from "./url-params";

export const ARRIVALS_WINDOW_KEY = "arrivals.window";

/** The most pages (of up to 100 posts) one load follows on its own before handing over to Load more. */
export const MAX_WINDOW_PAGES = 30;

const HOUR_MS = 60 * 60 * 1000;

const WINDOW_MS: Record<ArrivalWindow, number | null> = {
  "24h": 24 * HOUR_MS,
  "48h": 48 * HOUR_MS,
  "7d": 7 * 24 * HOUR_MS,
  all: null,
};

/** The window's length in milliseconds, or null for All. */
export function windowMs(window: ArrivalWindow): number | null {
  return WINDOW_MS[window];
}

/** The oldest observed time (epoch ms) the window still shows, or null for All. */
export function windowCutoff(window: ArrivalWindow, now: number): number | null {
  const ms = WINDOW_MS[window];
  return ms === null ? null : now - ms;
}

/** A cutoff as the sources route wants it (`since`, RFC 3339), or null for All. */
export function cutoffISO(cutoff: number | null): string | null {
  return cutoff === null ? null : new Date(cutoff).toISOString();
}

// An unreadable time sorts oldest in the feed, so it is also outside every
// finite window.
function observedEpoch(post: ArrivalAccountPost): number {
  const parsed = Date.parse(postObservedAt(post));
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/** True when the post was observed at or after the cutoff (always, for All). */
export function withinWindow(post: ArrivalAccountPost, cutoff: number | null): boolean {
  return cutoff === null || observedEpoch(post) >= cutoff;
}

/** The posts the window shows, in their input order; the same array for All. */
export function postsWithinWindow<P extends ArrivalAccountPost>(
  posts: readonly P[],
  cutoff: number | null,
): readonly P[] {
  return cutoff === null ? posts : posts.filter((post) => withinWindow(post, cutoff));
}

/**
 * True when a newest-first page has crossed the cutoff: its last row is older,
 * so every row a later page could return is older too and paging can stop.
 * Never for All or for an empty page.
 */
export function pageExhaustsWindow(
  page: readonly ArrivalAccountPost[],
  cutoff: number | null,
): boolean {
  if (cutoff === null || page.length === 0) return false;
  return !withinWindow(page[page.length - 1], cutoff);
}

/**
 * True when a load should fetch the next page on its own: the window is
 * finite, a page is left to fetch, and the run is still within the bound.
 * All never pages on its own, because there is no end to reach.
 */
export function windowPagingContinues(
  cutoff: number | null,
  nextCursor: object | null,
  pagesLoaded: number,
): boolean {
  return cutoff !== null && nextCursor !== null && pagesLoaded < MAX_WINDOW_PAGES;
}

/** The viewer's remembered window, or the default when none is stored or the stored one is not offered. */
export function readArrivalWindow(): ArrivalWindow {
  return parseWindowParam(readLocalStorage(ARRIVALS_WINDOW_KEY)) ?? DEFAULT_ARRIVAL_WINDOW;
}

export function writeArrivalWindow(window: ArrivalWindow): void {
  writeLocalStorage(ARRIVALS_WINDOW_KEY, window);
}
