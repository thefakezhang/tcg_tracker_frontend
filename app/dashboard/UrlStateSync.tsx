"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useGame } from "./GameContext";
import { useTrips } from "./TripContext";
import { useBuyList } from "./BuyListContext";
import { ARRIVALS_SHOP_PARAM, ARRIVALS_WINDOW_PARAM, parseShopParam, parseWindowParam } from "./url-params";
import { buildDashboardSearch, parseDashboardSearch } from "./url-state";

export { readUrlParam, writeUrlParam } from "./url-params";

// Keeps /dashboard's query string and the view-selection contexts in step,
// both ways:
//   - on first paint, the URL wins (deep links, reload, bookmarks);
//   - afterwards, every context change pushes a history entry, so the browser
//     back/forward buttons move between views;
//   - popstate re-applies the URL to the contexts.
// Leaf params are owned by a view (replaceState): the trip tab by
// TripDashboard, the arrivals shop and time window by ArrivalPostsView. Each is
// carried over unchanged while its selection stays the same and dropped otherwise.
const UrlHydratedContext = createContext(false);

/** True once the URL has been applied to the contexts (always false on the server). */
export function useUrlHydrated(): boolean {
  return useContext(UrlHydratedContext);
}

export default function UrlStateSync({ children }: { children: ReactNode }) {
  const [hydratedState, setHydratedState] = useState(false);
  const { activeGame, setActiveGame } = useGame();
  const { activeTripId, setActiveTripId } = useTrips();
  const { activeBuylistId, setActiveBuylistId } = useBuyList();
  const hydrated = useRef(false);
  const applyingFromUrl = useRef(false);
  const lastSelection = useRef<number | null>(null);

  const applyFromUrl = () => {
    const s = parseDashboardSearch(window.location.search);
    applyingFromUrl.current = true;
    setActiveGame(s.game);
    setActiveTripId(s.activeTripId);
    setActiveBuylistId(s.activeBuylistId);
    lastSelection.current = s.activeTripId;
  };

  // Before first paint so a deep link never flashes the default browse view.
  useLayoutEffect(() => {
    applyFromUrl();
    hydrated.current = true;
    setHydratedState(true);
    const onPop = () => applyFromUrl();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    if (applyingFromUrl.current) { applyingFromUrl.current = false; return; }
    const current = new URLSearchParams(window.location.search);
    // A leaf param survives only while the selection it belongs to is unchanged
    // (a game switch, say): the trip tab while the trip stays, the arrivals
    // shop and window while the view stays.
    const sameSelection = activeTripId != null && activeTripId === lastSelection.current;
    const isTrip = activeTripId != null && activeTripId > 0;
    const next = buildDashboardSearch({
      game: activeGame, activeTripId, activeBuylistId,
      tab: sameSelection && isTrip ? current.get("tab") : null,
      shop: sameSelection ? parseShopParam(current.get(ARRIVALS_SHOP_PARAM)) : null,
      since: sameSelection ? parseWindowParam(current.get(ARRIVALS_WINDOW_PARAM)) : null,
    });
    lastSelection.current = activeTripId;
    if (next !== window.location.search) {
      window.history.pushState(null, "", `${window.location.pathname}${next}`);
    }
  }, [activeGame, activeTripId, activeBuylistId]);

  return <UrlHydratedContext value={hydratedState}>{children}</UrlHydratedContext>;
}
