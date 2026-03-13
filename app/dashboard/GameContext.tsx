"use client";

import { createContext, useContext, useState } from "react";

export type Game = "pokemon" | "mtg";
export type PsaMode = "non-psa" | "psa";

export const GAME_LABELS: Record<Game, string> = {
  pokemon: "Pokémon",
  mtg: "Magic: The Gathering",
};

interface GameContextValue {
  activeGame: Game;
  setActiveGame: (game: Game) => void;
  psaMode: PsaMode;
  setPsaMode: (mode: PsaMode) => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [activeGame, setActiveGame] = useState<Game>("pokemon");
  const [psaMode, setPsaMode] = useState<PsaMode>("non-psa");
  return (
    <GameContext value={{ activeGame, setActiveGame, psaMode, setPsaMode }}>
      {children}
    </GameContext>
  );
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within GameProvider");
  return ctx;
}
