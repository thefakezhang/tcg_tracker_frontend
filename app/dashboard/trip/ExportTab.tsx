"use client";

import LotManager from "./LotManager";

// The export leg is now a first-class catalog leg — same lot -> finalize -> FIFO
// -> sale flow as import, filtered to leg='export'. (The former free-text
// "export goods" UI is retired; the export_goods tables remain in the schema
// but are no longer written from here.)
export default function ExportTab({ tripId }: { tripId: number }) {
  return <LotManager tripId={tripId} leg="export" />;
}
