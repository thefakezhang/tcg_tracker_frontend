"use client";

import CardBrowser from "./CardBrowser";
import SealedBrowser from "./SealedBrowser";
import BuyListView from "./BuyListView";
import TripDashboard from "./TripDashboard";
import { viewBySentinel } from "./views";
import { useBuyList } from "./BuyListContext";
import { useTrips } from "./TripContext";
import { useGame } from "./GameContext";

function DashboardContent() {
  const { activeBuylistId } = useBuyList();
  const { activeTripId } = useTrips();
  const { activeGame } = useGame();
  // Standalone views (0 = overview, negatives) come from the shared registry;
  // a positive activeTripId is a real trip, so it falls through to TripDashboard.
  const view = activeTripId != null ? viewBySentinel.get(activeTripId) : undefined;
  if (view) {
    return <>{view.render()}</>;
  }
  if (activeTripId) {
    return <TripDashboard key={`trip-${activeTripId}`} tripId={activeTripId} />;
  }
  if (activeBuylistId) {
    return <BuyListView key={`buylist-${activeBuylistId}`} buylistId={activeBuylistId} />;
  }
  if (activeGame === "pokemon_sealed") {
    return <SealedBrowser key="sealed" />;
  }
  return <CardBrowser key="browser" />;
}

export default function DashboardPage() {
  return <DashboardContent />;
}
