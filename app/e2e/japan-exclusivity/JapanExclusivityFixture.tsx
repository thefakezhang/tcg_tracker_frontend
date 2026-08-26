"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CriteriaAdd } from "@/app/dashboard/CustomersView";
import { JapanExclusiveEvidence } from "@/app/dashboard/JapanExclusiveEvidence";
import { JapanExclusivityCriterionField, type JapanExclusivityCriterionMode } from "@/app/dashboard/JapanExclusivityCriterionField";
import { JapanExclusivityFilter } from "@/app/dashboard/JapanExclusivityFilter";
import { matchesJapanExclusivity, type JapanExclusivityMode } from "@/app/dashboard/japan-exclusivity";

interface FixtureCard {
  id: string;
  name: string;
  number: string;
  japan_exclusive_artwork?: boolean;
  japan_exclusive_artwork_reason?: string;
  japan_exclusive_artwork_evidence_url?: string;
  japan_exclusive_stamps?: boolean;
  japan_exclusive_stamps_reason?: string;
  japan_exclusive_stamps_evidence_url?: string;
}

const CARDS: FixtureCard[] = [
  {
    id: "artwork",
    name: "Mario Pikachu",
    number: "293/XY-P",
    japan_exclusive_artwork: true,
    japan_exclusive_artwork_reason: "Official Japanese campaign artwork and exact promo history are independently corroborated.",
    japan_exclusive_artwork_evidence_url: "https://www.pokemon-card.com/products/xy/boxlz.html",
  },
  {
    id: "stamps",
    name: "Champions League Energy",
    number: "246/S-P",
    japan_exclusive_stamps: true,
    japan_exclusive_stamps_reason: "The exact Japanese printing carries the verified CL2022 event logo and marking.",
    japan_exclusive_stamps_evidence_url: "https://pokumon.com/card/grass-energy-246-s-p-japanese-promo/",
  },
  {
    id: "both",
    name: "Master's Key",
    number: "068/L-P",
    japan_exclusive_artwork: true,
    japan_exclusive_artwork_reason: "The award printing uses artwork documented for the Japanese World Championships prize.",
    japan_exclusive_artwork_evidence_url: "https://bulbapedia.bulbagarden.net/wiki/Master%27s_Key_%28L-P_Promo_68%29",
    japan_exclusive_stamps: true,
    japan_exclusive_stamps_reason: "The same physical printing has the independently documented gold WCS Japan logo and foil marking.",
    japan_exclusive_stamps_evidence_url: "https://www.pokumon.com/card/masters-key-068-l-p-japanese-promo/",
  },
  {
    id: "neither",
    name: "Pokemon Web reprint",
    number: "001/048",
  },
];

export function JapanExclusivityFixture() {
  const [mode, setMode] = useState<JapanExclusivityMode>("all");
  const [search, setSearch] = useState("");
  const [criterion, setCriterion] = useState<"" | JapanExclusivityCriterionMode>("");
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return CARDS.filter((card) =>
      matchesJapanExclusivity(card, mode) &&
      (!needle || `${card.name} ${card.number}`.toLocaleLowerCase().includes(needle)),
    );
  }, [mode, search]);
  const shoppingCandidates = criterion
    ? CARDS.filter((card) => matchesJapanExclusivity(card, criterion))
    : CARDS;

  const reset = () => {
    setMode("all");
    setSearch("");
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl overflow-x-hidden p-4 sm:p-8" data-testid="japan-exclusivity-fixture">
      <header className="mb-6 min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Controlled browser fixture</p>
        <h1 className="break-words text-2xl font-semibold sm:text-3xl">Japanese-exclusive printing evidence</h1>
        <p className="mt-2 max-w-3xl break-words text-sm text-muted-foreground">
          Either means verified exclusive artwork or a verified exclusive stamp / marking. Both requires independent evidence for both categories.
        </p>
      </header>

      <section className="mb-6 rounded-xl border bg-card p-3 sm:p-4" aria-label="Inventory filter fixture">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
          <JapanExclusivityFilter value={mode} onValueChange={setMode} />
          <Input
            aria-label="Search fixture cards"
            className="h-11 min-h-[44px] min-w-0 flex-1 sm:h-9 sm:min-h-0"
            placeholder="Search name or number"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button className="h-11 sm:h-9" variant="outline" onClick={reset}>Reset</Button>
        </div>
        <p className="mt-3 text-sm" aria-live="polite" data-testid="fixture-result-count">
          {filtered.length} matching printing{filtered.length === 1 ? "" : "s"}
        </p>

        {filtered.length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="fixture-empty-state">
            No printings match this verified classification and search.
          </div>
        ) : (
          <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            {filtered.map((card) => (
              <article
                key={card.id}
                className="min-w-0 overflow-hidden rounded-lg border p-3"
                data-testid={`fixture-card-${card.id}`}
              >
                <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="min-w-0 break-words font-medium">{card.name}</h2>
                  <Badge variant="secondary" className="shrink-0">{card.number}</Badge>
                </div>
                <JapanExclusiveEvidence card={card} />
                {!card.japan_exclusive_artwork && !card.japan_exclusive_stamps && (
                  <p className="text-xs text-muted-foreground">Reviewed reprint or unclassified printing.</p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="grid min-w-0 grid-cols-1 gap-4 rounded-xl border bg-card p-3 sm:p-4 lg:grid-cols-2" aria-label="Customer and shopping fixture">
        <div className="min-w-0">
          <h2 className="mb-2 font-medium">Customer purchase criterion</h2>
          <JapanExclusivityCriterionField
            id="fixture-customer-japan-mode"
            value={criterion}
            onValueChange={setCriterion}
          />
          <div className="mt-3">
            <CriteriaAdd customerId={17} onAdded={() => {}} />
          </div>
        </div>
        <div className="min-w-0 rounded-lg border p-3" data-testid="fixture-shopping-list">
          <h2 className="font-medium">Shopping candidates</h2>
          <p className="mt-1 break-words text-sm text-muted-foreground">
            Requested mode: {criterion || "any classification"}
          </p>
          <p className="mt-2 text-sm" data-testid="fixture-shopping-count">
            {shoppingCandidates.length} matching customer candidate{shoppingCandidates.length === 1 ? "" : "s"}
          </p>
          {shoppingCandidates.filter((card) => card.japan_exclusive_artwork || card.japan_exclusive_stamps).slice(0, 1).map((card) => (
            <div className="mt-3 min-w-0" key={card.id}>
              <JapanExclusiveEvidence card={card} compact />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
