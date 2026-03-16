"use client";

import CardBrowser from "./CardBrowser";
import BuyListView from "./BuyListView";
import { useBuyList } from "./BuyListContext";

function DashboardContent() {
  const { activeBuylistId } = useBuyList();
  if (activeBuylistId) {
    return <BuyListView key={`buylist-${activeBuylistId}`} buylistId={activeBuylistId} />;
  }
  return <CardBrowser key="browser" />;
}

export default function DashboardPage() {
  return <DashboardContent />;
}
