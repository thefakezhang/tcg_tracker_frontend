"use client";

import { createContext, useContext, useState } from "react";

export type Game = "pokemon" | "mtg";

export const GAME_LABELS: Record<Game, string> = {
  pokemon: "Pokémon",
  mtg: "Magic: The Gathering",
};

interface GameContextValue {
  activeGame: Game;
  setActiveGame: (game: Game) => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [activeGame, setActiveGame] = useState<Game>("pokemon");
  return (
    <GameContext value={{ activeGame, setActiveGame }}>{children}</GameContext>
  );
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within GameProvider");
  return ctx;
}
