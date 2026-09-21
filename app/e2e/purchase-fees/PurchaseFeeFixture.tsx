"use client";

import PurchasePlannerView from "@/app/dashboard/PurchasePlannerView";
import {
  LANGUAGE_LABELS,
  useLanguage,
  type Language,
} from "@/app/dashboard/LanguageContext";

export function PurchaseFeeFixture() {
  const { language, setLanguage } = useLanguage();
  return (
    <main
      className="mx-auto min-h-screen w-full max-w-7xl p-4 sm:p-8"
      data-testid="purchase-fee-fixture"
    >
      <header className="mb-6 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Controlled browser fixture
          </p>
          <h1 className="break-words text-2xl font-semibold sm:text-3xl">
            Effective purchase fees
          </h1>
        </div>
        <select
          aria-label="Language"
          className="min-h-11 rounded-md border bg-background px-3 text-sm sm:min-h-0 sm:py-1"
          value={language}
          onChange={(event) => setLanguage(event.target.value as Language)}
        >
          {(Object.keys(LANGUAGE_LABELS) as Language[]).map((code) => (
            <option key={code} value={code}>{LANGUAGE_LABELS[code]}</option>
          ))}
        </select>
      </header>
      <PurchasePlannerView />
    </main>
  );
}
