"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { type Game } from "./GameContext";

export interface Buylist {
  buylist_id: number;
  name: string;
  description: string | null;
  created_at: string;
}

interface BuyListContextValue {
  buylists: Buylist[];
  activeBuylistId: number | null;
  setActiveBuylistId: (id: number | null) => void;
  fetchBuylists: () => Promise<void>;
  createBuylist: (name: string, description: string | null) => Promise<void>;
  deleteBuylist: (buylistId: number) => Promise<void>;
  addToBuylist: (
    buylistId: number,
    game: Game,
    cardId: string,
    psaGrade: number,
    notes: string | null
  ) => Promise<void>;
  removeFromBuylist: (game: Game, entryId: number) => Promise<void>;
}

const BuyListContext = createContext<BuyListContextValue | null>(null);

const ENTRY_TABLE_MAP: Record<Game, string> = {
  pokemon: "pokemon_buylist_entries",
  mtg: "mtg_buylist_entries",
};

export function BuyListProvider({ children }: { children: React.ReactNode }) {
  const [buylists, setBuylists] = useState<Buylist[]>([]);
  const [activeBuylistId, setActiveBuylistId] = useState<number | null>(null);

  const fetchBuylists = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("buylists")
      .select("buylist_id, name, description, created_at")
      .order("created_at", { ascending: false });
    setBuylists((data as Buylist[]) ?? []);
  }, []);

  useEffect(() => {
    fetchBuylists();
  }, [fetchBuylists]);

  const createBuylist = useCallback(
    async (name: string, description: string | null) => {
      const supabase = createClient();
      await supabase.from("buylists").insert({ name, description });
      await fetchBuylists();
    },
    [fetchBuylists]
  );

  const deleteBuylist = useCallback(
    async (buylistId: number) => {
      const supabase = createClient();
      // Delete entries first
      await supabase.from("pokemon_buylist_entries").delete().eq("buylist_id", buylistId);
      await supabase.from("mtg_buylist_entries").delete().eq("buylist_id", buylistId);
      await supabase.from("buylists").delete().eq("buylist_id", buylistId);
      if (activeBuylistId === buylistId) setActiveBuylistId(null);
      await fetchBuylists();
    },
    [fetchBuylists, activeBuylistId]
  );

  const addToBuylist = useCallback(
    async (
      buylistId: number,
      game: Game,
      cardId: string,
      psaGrade: number,
      notes: string | null
    ) => {
      const supabase = createClient();
      await supabase
        .from(ENTRY_TABLE_MAP[game])
        .insert({ buylist_id: buylistId, card_id: cardId, psa_grade: psaGrade, notes });
    },
    []
  );

  const removeFromBuylist = useCallback(async (game: Game, entryId: number) => {
    const supabase = createClient();
    await supabase.from(ENTRY_TABLE_MAP[game]).delete().eq("entry_id", entryId);
  }, []);

  return (
    <BuyListContext
      value={{
        buylists,
        activeBuylistId,
        setActiveBuylistId,
        fetchBuylists,
        createBuylist,
        deleteBuylist,
        addToBuylist,
        removeFromBuylist,
      }}
    >
      {children}
    </BuyListContext>
  );
}

export function useBuyList() {
  const ctx = useContext(BuyListContext);
  if (!ctx) throw new Error("useBuyList must be used within BuyListProvider");
  return ctx;
}
