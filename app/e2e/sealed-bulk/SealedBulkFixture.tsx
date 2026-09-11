"use client";

import SealedBrowser from "@/app/dashboard/SealedBrowser";

export function SealedBulkFixture() {
  return (
    <main
      className="mx-auto min-h-screen w-full max-w-7xl overflow-x-hidden p-4 sm:p-8"
      data-testid="sealed-bulk-fixture"
    >
      <header className="mb-6 min-w-0">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Controlled browser fixture
        </p>
        <h1 className="break-words text-2xl font-semibold sm:text-3xl">
          Sealed purchase-plan bulk add
        </h1>
      </header>
      <SealedBrowser />
    </main>
  );
}
