// The Arrivals feed's quiet refresh while a selected region is being read
// once. A read fills a region shop by shop over some minutes, so while one is
// pending the view refreshes the focus status, the account summary and the
// first page of the feed every POLL_INTERVAL_MS, merges the new posts in
// without disturbing what the operator has loaded or where they are reading,
// and stops when no selected region is pending, after POLL_LIMIT_MS, or for as
// long as the tab is hidden.
import { type ArrivalAccountPost, postObservedAt } from "./arrival-accounts";

export const POLL_INTERVAL_MS = 20 * 1000;
export const POLL_LIMIT_MS = 30 * 60 * 1000;
/** The most pages one refresh follows to reach a post already loaded. */
export const MAX_POLL_PAGES = 10;

function observedEpoch(post: ArrivalAccountPost): number {
  const parsed = Date.parse(postObservedAt(post));
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * The loaded posts with a refresh merged in: a post the refresh brings for
 * the first time joins the list, one already loaded takes the refreshed copy
 * (a re-post moves it up), nothing loaded is dropped, and the list stays
 * newest first by observed time, as the backend orders it and the window
 * logic expects. Ties keep their order, new posts ahead. The same array comes
 * back when nothing changed, so an idle refresh renders nothing.
 */
export function mergeFreshPosts<P extends ArrivalAccountPost>(known: readonly P[], fresh: readonly P[]): readonly P[] {
  const freshByKey = new Map<string, P>();
  for (const post of fresh) if (!freshByKey.has(post.arrival_key)) freshByKey.set(post.arrival_key, post);
  const knownKeys = new Set(known.map((post) => post.arrival_key));
  const added = [...freshByKey.values()].filter((post) => !knownKeys.has(post.arrival_key));
  let changed = added.length > 0;
  const updated = known.map((post) => {
    const refreshed = freshByKey.get(post.arrival_key);
    if (refreshed === undefined || JSON.stringify(refreshed) === JSON.stringify(post)) return post;
    changed = true;
    return refreshed;
  });
  if (!changed) return known;
  return [...added, ...updated]
    .map((post, index) => ({ post, index, epoch: observedEpoch(post) }))
    .sort((a, b) => (a.epoch === b.epoch ? a.index - b.index : b.epoch > a.epoch ? 1 : -1))
    .map(({ post }) => post);
}

/**
 * Where the operator is reading: the first post card still in view, its
 * position, and the position of the account panel that scrolls it, if any.
 * Post cards carry `data-arrival-key`; a panel that scrolls on its own carries
 * `data-arrival-scroll`.
 */
export type ScrollAnchor = {
  key: string;
  top: number;
  /** The panel's top, when the card sits in a panel that scrolls on its own. */
  panelTop: number | null;
  /** Whether the page and the panel had been scrolled at all; at the very top new posts simply appear. */
  pageScrolled: boolean;
  panelScrolled: boolean;
};

function panelOf(card: HTMLElement): HTMLElement | null {
  return card.parentElement?.closest<HTMLElement>("[data-arrival-scroll]") ?? null;
}

export function captureScrollAnchor(root: HTMLElement | null): ScrollAnchor | null {
  if (root === null) return null;
  for (const card of root.querySelectorAll<HTMLElement>("[data-arrival-key]")) {
    const rect = card.getBoundingClientRect();
    const panel = panelOf(card);
    const panelRect = panel?.getBoundingClientRect() ?? null;
    // In view: below the top of the window and, inside a panel, below the panel's top.
    if (rect.bottom <= Math.max(0, panelRect?.top ?? 0)) continue;
    return {
      key: card.dataset.arrivalKey ?? "",
      top: rect.top,
      panelTop: panelRect?.top ?? null,
      pageScrolled: window.scrollY > 0,
      panelScrolled: (panel?.scrollTop ?? 0) > 0,
    };
  }
  return null;
}

/**
 * Scrolls back to the anchor after posts were merged in above it: the page by
 * however far the anchor's panel (or the card) moved, then the panel by however
 * far the card moved inside it. Browser scroll anchoring is switched off on the
 * feed (`overflow-anchor: none`), so this is the one correction on every
 * browser, including those without anchoring.
 */
export function restoreScrollAnchor(root: HTMLElement | null, anchor: ScrollAnchor | null): void {
  if (root === null || anchor === null) return;
  const card = [...root.querySelectorAll<HTMLElement>("[data-arrival-key]")]
    .find((element) => element.dataset.arrivalKey === anchor.key);
  if (card === undefined) return;
  const panel = panelOf(card);
  if (anchor.pageScrolled) {
    const moved = panel !== null && anchor.panelTop !== null
      ? panel.getBoundingClientRect().top - anchor.panelTop
      : card.getBoundingClientRect().top - anchor.top;
    if (moved !== 0) window.scrollBy(0, moved);
  }
  if (panel !== null && anchor.panelTop !== null && anchor.panelScrolled) {
    const inside = (card.getBoundingClientRect().top - panel.getBoundingClientRect().top)
      - (anchor.top - anchor.panelTop);
    if (inside !== 0) panel.scrollTop += inside;
  }
}
