"use client";

import MtgMetaView from "@/app/dashboard/MtgMetaView";
import { MtgFormatBadges, MtgLabelEvidence } from "@/app/dashboard/MtgLabelEvidence";
import type { MtgLabelProvenance, MtgTagFlags } from "@/app/dashboard/mtg-tags";
import fixture from "./fixture-data.json";

type LabelCard = MtgTagFlags & MtgLabelProvenance & { name: string };

// Five real cards with their real format_play objects: one format (Sol Ring,
// cEDH), two and three formats (Arid Mesa), main deck and sideboard (Consign
// to Memory), and a clear riser (Multiversal Passage in Standard).
export function MtgFormatMetaFixture() {
  const cards = fixture.labelCards as unknown as LabelCard[];
  return (
    <main className="flex min-w-0 flex-col gap-6 p-4">
      <section aria-label="label evidence" className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <div key={card.name} className="min-w-0 rounded-md border p-2" data-testid={`fixture-label-${card.name}`}>
            <div className="mb-1 truncate text-sm font-medium">{card.name}</div>
            <MtgLabelEvidence card={card} compact />
            <div className="mt-2" data-testid="fixture-badges">
              <MtgFormatBadges card={card} />
            </div>
          </div>
        ))}
      </section>
      <MtgMetaView />
    </main>
  );
}
