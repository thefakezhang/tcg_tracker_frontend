"use client";

import { useEffect, useState } from "react";
import CardDetailModal from "@/app/dashboard/CardDetailModal";
import { GameProvider } from "@/app/dashboard/GameContext";
import { LanguageProvider } from "@/app/dashboard/LanguageContext";
import { CurrencyProvider } from "@/app/dashboard/CurrencyContext";
import { BuyListProvider } from "@/app/dashboard/BuyListContext";
import { TripProvider } from "@/app/dashboard/TripContext";
import { LotPickerProvider } from "@/app/dashboard/LotPickerContext";
import { ExitBasisProvider } from "@/app/dashboard/ExitBasisContext";
import { fetchLocationMap, type CardRowData } from "@/app/dashboard/use-card-data";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

let locationWarmup: ReturnType<typeof fetchLocationMap> | null = null;

const cards: CardRowData[] = [11, 22].map((id) => ({
  key: String(id),
  card: { card_id: String(id), regional_name: `Card ${id}`, english_name: `Card ${id}`, set_code: "TEST", card_number: String(id), misc_info: null, image_url: null, language: "jp" },
  prices: { highestBuy: null, lowestSell: null }, roi: null,
}));

export function CardDetailLoadFixture() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // GradeEvidencePanel also reads locations. Warm the real shared cache first
    // so the next locations request is the modal's missing-source refresh.
    locationWarmup ??= fetchLocationMap(createClient());
    void locationWarmup.then(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);
  const [selected, setSelected] = useState<CardRowData>(cards[0]);
  const [open, setOpen] = useState(false);
  return (
    <LanguageProvider><GameProvider><CurrencyProvider><BuyListProvider>
      <TripProvider><LotPickerProvider><ExitBasisProvider>
        <main className="mx-auto min-h-screen max-w-4xl space-y-4 p-6">
          <h1 className="text-xl font-semibold">Card detail loading fixture</h1>
          <p>Open a card, close it, and open another while controlled responses are pending.</p>
          <div className="flex gap-3">
            {cards.map((row) => <Button key={row.key} className="min-h-11" disabled={!ready} onClick={() => { setSelected(row); setOpen(true); }}>Open {row.card.english_name}</Button>)}
          </div>
          <CardDetailModal card={selected} open={open} onClose={() => setOpen(false)} />
        </main>
      </ExitBasisProvider></LotPickerProvider></TripProvider>
    </BuyListProvider></CurrencyProvider></GameProvider></LanguageProvider>
  );
}
