// The dashboard is one route (/dashboard) whose content is chosen by in-memory
// context state: activeTripId (0 = trips overview, negative sentinels =
// standalone views, positive = a trip), activeBuylistId, activeGame, and a
// trip's tab. Nothing about that was in the URL, so a reload always landed on
// the browse page and no view could be linked or bookmarked.
//
// This module is the pure codec between that state and the query string:
//   /dashboard                           browse, Pokemon
//   /dashboard?game=mtg                  browse, MTG
//   /dashboard?view=customers            a standalone view, by ViewDef.slug
//   /dashboard?view=arrivals&shop=alice  the Arrivals view, one shop's posts
//   /dashboard?view=arrivals&since=7d    the Arrivals view, the last 7 days
//   /dashboard?view=mercari&lane=psa     the Mercari leads feed, PSA lane
//   /dashboard?view=mercari&feed=verified the Mercari verified deals
//   /dashboard?trip=4&tab=sales          a trip and its tab
//   /dashboard?buylist=2                 a buy list
// UrlStateSync owns reading it on load / popstate and writing it on change.
import type { Game } from "./GameContext";
import {
  ARRIVALS_SHOP_PARAM,
  ARRIVALS_WINDOW_PARAM,
  type ArrivalWindow,
  MERCARI_FEED_PARAM,
  MERCARI_LANE_PARAM,
  MERCARI_SORT_PARAM,
  type MercariFeed,
  type MercariLeadLane,
  type MercariLeadSort,
  parseMercariFeedParam,
  parseMercariLaneParam,
  parseMercariSortParam,
  parseShopParam,
  parseWindowParam,
} from "./url-params";
import { viewBySentinel, viewBySlug } from "./views";

export const GAMES: readonly Game[] = ["pokemon", "mtg", "pokemon_sealed"];
const DEFAULT_GAME: Game = "pokemon";

/** The views with leaf params of their own in this codec. */
export const ARRIVALS_VIEW_SLUG = "arrivals";
export const MERCARI_VIEW_SLUG = "mercari";

export interface DashboardUrlState {
  game: Game;
  /** activeTripId as the contexts hold it: null = browse / buylist. */
  activeTripId: number | null;
  activeBuylistId: number | null;
  /** Trip tab, only meaningful when activeTripId > 0. */
  tab: string | null;
  /** Arrivals shop filter (a buyer_handle), only meaningful when the view is arrivals. */
  shop: string | null;
  /** Arrivals time window, only meaningful when the view is arrivals; the view keeps its default out of the URL. */
  since: ArrivalWindow | null;
  /** Mercari feed (leads or verified), only meaningful when the view is mercari; the default stays out of the URL. */
  feed: MercariFeed | null;
  /** Mercari leads lane, only meaningful when the view is mercari. */
  lane: MercariLeadLane | null;
  /** Mercari leads sort, only meaningful when the view is mercari. */
  sort: MercariLeadSort | null;
}

const NO_MERCARI = { feed: null, lane: null, sort: null } as const;

export function parseDashboardSearch(search: string): DashboardUrlState {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const gameRaw = p.get("game");
  const game = (GAMES as readonly string[]).includes(gameRaw ?? "") ? (gameRaw as Game) : DEFAULT_GAME;
  const view = p.get("view");
  const trip = Number(p.get("trip"));
  const buylist = Number(p.get("buylist"));
  const tab = p.get("tab");
  if (view && viewBySlug.has(view)) {
    const arrivals = view === ARRIVALS_VIEW_SLUG;
    const mercari = view === MERCARI_VIEW_SLUG;
    return {
      game,
      activeTripId: viewBySlug.get(view)!.sentinel,
      activeBuylistId: null,
      tab: null,
      shop: arrivals ? parseShopParam(p.get(ARRIVALS_SHOP_PARAM)) : null,
      since: arrivals ? parseWindowParam(p.get(ARRIVALS_WINDOW_PARAM)) : null,
      feed: mercari ? parseMercariFeedParam(p.get(MERCARI_FEED_PARAM)) : null,
      lane: mercari ? parseMercariLaneParam(p.get(MERCARI_LANE_PARAM)) : null,
      sort: mercari ? parseMercariSortParam(p.get(MERCARI_SORT_PARAM)) : null,
    };
  }
  if (Number.isInteger(trip) && trip > 0) {
    return { game, activeTripId: trip, activeBuylistId: null, tab: tab && /^[a-z-]+$/.test(tab) ? tab : null, shop: null, since: null, ...NO_MERCARI };
  }
  if (Number.isInteger(buylist) && buylist > 0) {
    return { game, activeTripId: null, activeBuylistId: buylist, tab: null, shop: null, since: null, ...NO_MERCARI };
  }
  return { game, activeTripId: null, activeBuylistId: null, tab: null, shop: null, since: null, ...NO_MERCARI };
}

export function buildDashboardSearch(state: DashboardUrlState): string {
  const p = new URLSearchParams();
  if (state.game !== DEFAULT_GAME) p.set("game", state.game);
  if (state.activeTripId != null) {
    const view = viewBySentinel.get(state.activeTripId);
    if (view) {
      p.set("view", view.slug);
      if (view.slug === ARRIVALS_VIEW_SLUG) {
        if (state.shop) p.set(ARRIVALS_SHOP_PARAM, state.shop);
        if (state.since) p.set(ARRIVALS_WINDOW_PARAM, state.since);
      }
      if (view.slug === MERCARI_VIEW_SLUG) {
        if (state.feed) p.set(MERCARI_FEED_PARAM, state.feed);
        if (state.lane) p.set(MERCARI_LANE_PARAM, state.lane);
        if (state.sort) p.set(MERCARI_SORT_PARAM, state.sort);
      }
    } else if (state.activeTripId > 0) {
      p.set("trip", String(state.activeTripId));
      if (state.tab) p.set("tab", state.tab);
    }
  } else if (state.activeBuylistId != null) {
    p.set("buylist", String(state.activeBuylistId));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}
