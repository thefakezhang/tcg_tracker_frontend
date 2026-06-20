"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Open (not-yet-finalized) acquisition lots, so the browse UI can drop cards
// straight into a lot the same way it drops them into a buylist.
export interface OpenLot {
  lot_id: number;
  trip_id: number | null;
  leg: string; // 'import' | 'export'
  shop_label: string | null;
  acquired_at: string;
}

type CardGame = "pokemon" | "mtg";
const LINE_TABLE: Record<CardGame, string> = {
  pokemon: "pokemon_lot_lines",
  mtg: "mtg_lot_lines",
};

export interface AddCardLineArgs {
  lotId: number;
  game: CardGame;
  cardId: string | number;
  conditionId: number;
  psaGrade?: number;
  quantity: number;
  overrideUsd?: number | null;
  marketValueUsd?: number | null;
}

export interface AddSealedLineArgs {
  lotId: number;
  productId: string | number;
  sealedCondition: string;
  variantEdition: string;
  quantity: number;
  overrideUsd?: number | null;
  marketValueUsd?: number | null;
}

interface LotPickerValue {
  openLots: OpenLot[];
  refresh: () => Promise<void>;
  addCardLine: (a: AddCardLineArgs) => Promise<void>;
  addSealedLine: (a: AddSealedLineArgs) => Promise<void>;
}

const LotPickerContext = createContext<LotPickerValue | null>(null);

export function LotPickerProvider({ children }: { children: React.ReactNode }) {
  const [openLots, setOpenLots] = useState<OpenLot[]>([]);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("acquisition_lots")
      .select("lot_id, trip_id, leg, shop_label, acquired_at")
      .eq("lines_imported", false)
      .order("acquired_at", { ascending: false });
    setOpenLots((data as OpenLot[]) ?? []);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addCardLine = useCallback(async (a: AddCardLineArgs) => {
    const supabase = createClient();
    await supabase.from(LINE_TABLE[a.game]).insert({
      lot_id: a.lotId,
      card_id: a.cardId,
      condition_id: a.conditionId,
      psa_grade: a.psaGrade ?? 0,
      quantity: a.quantity,
      price_override_usd: a.overrideUsd ?? null,
      market_value_usd: a.marketValueUsd ?? null,
    });
  }, []);

  const addSealedLine = useCallback(async (a: AddSealedLineArgs) => {
    const supabase = createClient();
    await supabase.from("pokemon_sealed_lot_lines").insert({
      lot_id: a.lotId,
      product_id: a.productId,
      sealed_condition: a.sealedCondition,
      variant_edition: a.variantEdition,
      quantity: a.quantity,
      price_override_usd: a.overrideUsd ?? null,
      market_value_usd: a.marketValueUsd ?? null,
    });
  }, []);

  return (
    <LotPickerContext value={{ openLots, refresh, addCardLine, addSealedLine }}>
      {children}
    </LotPickerContext>
  );
}

export function useLotPicker() {
  const ctx = useContext(LotPickerContext);
  if (!ctx) throw new Error("useLotPicker must be used within LotPickerProvider");
  return ctx;
}
