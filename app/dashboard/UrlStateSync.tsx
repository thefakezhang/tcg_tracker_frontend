"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useGame } from "./GameContext";
import { useTrips } from "./TripContext";
import { useBuyList } from "./BuyListContext";
import { buildDashboardSearch, parseDashboardSearch } from "./url-state";

// Keeps /dashboard's query string and the view-selection contexts in step,
// both ways:
//   - on first paint, the URL wins (deep links, reload, bookmarks);
//   - afterwards, every context change pushes a history entry, so the browser
//     back/forward buttons move between views;
//   - popstate re-applies the URL to the contexts.
// The trip tab is a leaf param owned by TripDashboard (replaceState); it is
// carried over unchanged while the trip stays the same and dropped otherwise.
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
  const lastTrip = useRef<number | null>(null);

  const applyFromUrl = () => {
    const s = parseDashboardSearch(window.location.search);
    applyingFromUrl.current = true;
    setActiveGame(s.game);
    setActiveTripId(s.activeTripId);
    setActiveBuylistId(s.activeBuylistId);
    lastTrip.current = s.activeTripId != null && s.activeTripId > 0 ? s.activeTripId : null;
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
    const trip = activeTripId != null && activeTripId > 0 ? activeTripId : null;
    const currentTab = new URLSearchParams(window.location.search).get("tab");
    const next = buildDashboardSearch({
      game: activeGame, activeTripId, activeBuylistId,
      tab: trip != null && trip === lastTrip.current ? currentTab : null,
    });
    lastTrip.current = trip;
    if (next !== window.location.search) {
      window.history.pushState(null, "", `${window.location.pathname}${next}`);
    }
  }, [activeGame, activeTripId, activeBuylistId]);

  return <UrlHydratedContext value={hydratedState}>{children}</UrlHydratedContext>;
}

/** Read one leaf query param (for components that own a sub-state, e.g. a trip tab). */
export function readUrlParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

/** Write one leaf query param in place (no history entry). */
export function writeUrlParam(name: string, value: string | null) {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams(window.location.search);
  if (value == null || value === "") p.delete(name); else p.set(name, value);
  const s = p.toString();
  const next = `${window.location.pathname}${s ? `?${s}` : ""}`;
  if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
}
