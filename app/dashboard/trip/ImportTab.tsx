"use client";

import LotManager from "./LotManager";

export default function ImportTab({ tripId }: { tripId: number }) {
  return <LotManager tripId={tripId} leg="import" />;
}
