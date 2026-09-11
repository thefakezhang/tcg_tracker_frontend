"use client";

import { useState } from "react";
import BuyListView from "@/app/dashboard/BuyListView";
import CardBrowser from "@/app/dashboard/CardBrowser";
import { useGame } from "@/app/dashboard/GameContext";
import PokemonCardIndex from "@/app/dashboard/PokemonCardIndex";
import { Button } from "@/components/ui/button";

type FixtureSurface = "browser" | "buylist" | "index";

export function PokemonVariantProjectionFixture() {
  const [surface, setSurface] = useState<FixtureSurface>("browser");
  const { activeGame, setActiveGame } = useGame();

  return (
    <main
      className="mx-auto min-h-screen w-full max-w-7xl p-4 sm:p-8"
      data-testid="pokemon-variant-projection-fixture"
    >
      <header className="mb-6 min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Controlled browser fixture
        </p>
        <h1 className="break-words text-2xl font-semibold sm:text-3xl">
          Pokemon typed variant projection
        </h1>
      </header>

      <section
        aria-label="Variant projection fixture controls"
        className="mb-6 flex min-w-0 flex-wrap gap-2 rounded-xl border bg-card p-3"
      >
        <Button
          className="h-11 sm:h-9"
          variant={surface === "browser" ? "default" : "outline"}
          aria-pressed={surface === "browser"}
          data-testid="fixture-surface-browser"
          onClick={() => setSurface("browser")}
        >
          Browser
        </Button>
        <Button
          className="h-11 sm:h-9"
          variant={surface === "buylist" ? "default" : "outline"}
          aria-pressed={surface === "buylist"}
          data-testid="fixture-surface-buylist"
          onClick={() => setSurface("buylist")}
        >
          Buy List
        </Button>
        <Button
          className="h-11 sm:h-9"
          variant={surface === "index" ? "default" : "outline"}
          aria-pressed={surface === "index"}
          data-testid="fixture-surface-index"
          onClick={() => setSurface("index")}
        >
          Card Index
        </Button>
        {surface === "browser" && (
          <div className="flex min-w-0 flex-wrap gap-2 border-l pl-2" role="group" aria-label="Fixture game">
            <Button
              className="h-11 sm:h-9"
              variant={activeGame === "pokemon" ? "default" : "outline"}
              aria-pressed={activeGame === "pokemon"}
              data-testid="fixture-game-pokemon"
              onClick={() => setActiveGame("pokemon")}
            >
              Pokemon
            </Button>
            <Button
              className="h-11 sm:h-9"
              variant={activeGame === "mtg" ? "default" : "outline"}
              aria-pressed={activeGame === "mtg"}
              data-testid="fixture-game-mtg"
              onClick={() => setActiveGame("mtg")}
            >
              MTG
            </Button>
          </div>
        )}
      </section>

      <section className="min-w-0" data-testid={`fixture-production-${surface}`}>
        {surface === "browser" && <CardBrowser key={`browser-${activeGame}`} />}
        {surface === "buylist" && <BuyListView buylistId={77} />}
        {surface === "index" && <PokemonCardIndex />}
      </section>
    </main>
  );
}
