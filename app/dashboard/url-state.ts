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
//   /dashboard?trip=4&tab=sales          a trip and its tab
//   /dashboard?buylist=2                 a buy list
// UrlStateSync owns reading it on load / popstate and writing it on change.
import type { Game } from "./GameContext";
import {
  ARRIVALS_SHOP_PARAM,
  ARRIVALS_WINDOW_PARAM,
  type ArrivalWindow,
  parseShopParam,
  parseWindowParam,
} from "./url-params";
import { viewBySentinel, viewBySlug } from "./views";

export const GAMES: readonly Game[] = ["pokemon", "mtg", "pokemon_sealed"];
const DEFAULT_GAME: Game = "pokemon";

/** The one view with leaf params of its own in this codec. */
export const ARRIVALS_VIEW_SLUG = "arrivals";

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
}

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
    return {
      game,
      activeTripId: viewBySlug.get(view)!.sentinel,
      activeBuylistId: null,
      tab: null,
      shop: arrivals ? parseShopParam(p.get(ARRIVALS_SHOP_PARAM)) : null,
      since: arrivals ? parseWindowParam(p.get(ARRIVALS_WINDOW_PARAM)) : null,
    };
  }
  if (Number.isInteger(trip) && trip > 0) {
    return { game, activeTripId: trip, activeBuylistId: null, tab: tab && /^[a-z-]+$/.test(tab) ? tab : null, shop: null, since: null };
  }
  if (Number.isInteger(buylist) && buylist > 0) {
    return { game, activeTripId: null, activeBuylistId: buylist, tab: null, shop: null, since: null };
  }
  return { game, activeTripId: null, activeBuylistId: null, tab: null, shop: null, since: null };
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
