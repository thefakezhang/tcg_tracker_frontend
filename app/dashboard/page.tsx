"use client";

import CardBrowser from "./CardBrowser";
import BuyListView from "./BuyListView";
import TripDashboard from "./TripDashboard";
import TripsOverview from "./TripsOverview";
import { useBuyList } from "./BuyListContext";
import { useTrips } from "./TripContext";

function DashboardContent() {
  const { activeBuylistId } = useBuyList();
  const { activeTripId } = useTrips();
  if (activeTripId === 0) {
    return <TripsOverview key="trips-overview" />;
  }
  if (activeTripId) {
    return <TripDashboard key={`trip-${activeTripId}`} tripId={activeTripId} />;
  }
  if (activeBuylistId) {
    return <BuyListView key={`buylist-${activeBuylistId}`} buylistId={activeBuylistId} />;
  }
  return <CardBrowser key="browser" />;
}

export default function DashboardPage() {
  return <DashboardContent />;
}
