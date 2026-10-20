"use client";

import { useState } from "react";
import CurationView from "@/app/dashboard/CurationView";
import SealedCurationView from "@/app/dashboard/SealedCurationView";
import { Button } from "@/components/ui/button";

type ReviewKind = "singles" | "sealed";

export function TwitterBuylistReviewFixture() {
  const [kind, setKind] = useState<ReviewKind>("singles");

  return (
    <main
      className="mx-auto min-h-screen w-full max-w-7xl p-3 sm:p-8"
      data-testid="twitter-buylist-review-fixture"
    >
      <header className="mb-4 min-w-0 sm:mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Controlled browser fixture
        </p>
        <h1 className="break-words text-2xl font-semibold sm:text-3xl">
          Reviewed Twitter buylist authority
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          The production review cards below render only the server review document and
          require its exact source evidence before approval.
        </p>
      </header>

      <section
        aria-label="Reviewed buylist fixture controls"
        className="mb-4 flex min-w-0 flex-wrap gap-2 rounded-xl border bg-card p-3 sm:mb-6"
      >
        <Button
          className="min-h-11 min-w-11"
          variant={kind === "singles" ? "default" : "outline"}
          aria-pressed={kind === "singles"}
          data-testid="fixture-kind-singles"
          onClick={() => setKind("singles")}
        >
          Singles
        </Button>
        <Button
          className="min-h-11 min-w-11"
          variant={kind === "sealed" ? "default" : "outline"}
          aria-pressed={kind === "sealed"}
          data-testid="fixture-kind-sealed"
          onClick={() => setKind("sealed")}
        >
          Sealed
        </Button>
      </section>

      <section className="min-w-0" data-testid={`fixture-production-${kind}`}>
        {kind === "singles" ? <CurationView /> : <SealedCurationView />}
      </section>
    </main>
  );
}
