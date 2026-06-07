"use client";

import CardBrowser from "./CardBrowser";
import SealedBrowser from "./SealedBrowser";
import BuyListView from "./BuyListView";
import { useBuyList } from "./BuyListContext";
import { useGame } from "./GameContext";

function DashboardContent() {
  const { activeBuylistId } = useBuyList();
  const { activeGame } = useGame();
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
