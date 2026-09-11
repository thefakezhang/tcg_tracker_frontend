"use client";

import SourceHealthView from "@/app/dashboard/SourceHealthView";
import { useLanguage } from "@/app/dashboard/LanguageContext";
import { Button } from "@/components/ui/button";

export function SourceHealthCoverageFixture() {
  const { language, setLanguage } = useLanguage();

  return (
    <main
      className="mx-auto min-h-screen w-full max-w-7xl overflow-x-hidden p-4 sm:p-8"
      data-testid="source-health-coverage-fixture"
    >
      <header className="mb-4 min-w-0">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Controlled browser fixture
        </p>
        <h1 className="break-words text-2xl font-semibold sm:text-3xl">
          Source collection coverage
        </h1>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Fixture language">
          <Button
            className="h-11 sm:h-9"
            variant={language === "en" ? "default" : "outline"}
            aria-pressed={language === "en"}
            onClick={() => setLanguage("en")}
          >
            English
          </Button>
          <Button
            className="h-11 sm:h-9"
            variant={language === "ja" ? "default" : "outline"}
            aria-pressed={language === "ja"}
            onClick={() => setLanguage("ja")}
          >
            日本語
          </Button>
        </div>
      </header>
      <section className="min-w-0 rounded-xl border bg-card" aria-label="Source health dashboard fixture">
        <SourceHealthView />
      </section>
    </main>
  );
}
