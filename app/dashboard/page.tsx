"use client";

import CardBrowser from "./CardBrowser";
import SealedBrowser from "./SealedBrowser";
import BuyListView from "./BuyListView";
import TripDashboard from "./TripDashboard";
import TripsOverview from "./TripsOverview";
import InventoryView from "./InventoryView";
import SalesView from "./SalesView";
import CurationView from "./CurationView";
import SealedCurationView from "./SealedCurationView";
import CardIndexView from "./CardIndexView";
import MatchReviewView from "./MatchReviewView";
import CustomersView from "./CustomersView";
import ReachOutView from "./ReachOutView";
import ShoppingListView from "./ShoppingListView";
import FinancesView from "./FinancesView";
import ExpensesTab from "./trip/ExpensesTab";
import { useBuyList } from "./BuyListContext";
import { useTrips } from "./TripContext";
import { useGame } from "./GameContext";

function DashboardContent() {
  const { activeBuylistId } = useBuyList();
  const { activeTripId } = useTrips();
  const { activeGame } = useGame();
  if (activeTripId === 0) {
    return <TripsOverview key="trips-overview" />;
  }
  if (activeTripId === -1) {
    return <InventoryView key="inventory" />;
  }
  if (activeTripId === -2) {
    return <SalesView key="sales" />;
  }
  if (activeTripId === -3) {
    return <CurationView key="curation" />;
  }
  if (activeTripId === -9) {
    return <SealedCurationView key="sealed-curation" />;
  }
  if (activeTripId === -4) {
    return <div key="expenses" className="p-4"><ExpensesTab tripId={null} /></div>;
  }
  if (activeTripId === -5) {
    return <CardIndexView key="card-index" />;
  }
  if (activeTripId === -6) {
    return <MatchReviewView key="match-review" />;
  }
  if (activeTripId === -7) {
    return <CustomersView key="customers" />;
  }
  if (activeTripId === -8) {
    return <ReachOutView key="reachout" />;
  }
  if (activeTripId === -10) {
    return <ShoppingListView key="shopping-list" />;
  }
  if (activeTripId === -11) {
    return <FinancesView key="finances" />;
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
