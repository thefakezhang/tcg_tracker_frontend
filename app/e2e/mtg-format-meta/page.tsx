import { notFound } from "next/navigation";
import { LanguageProvider } from "@/app/dashboard/LanguageContext";
import { MtgFormatMetaFixture } from "./MtgFormatMetaFixture";

export const dynamic = "force-dynamic";

// A controlled render of the mtgtop8 format labels and the MTG meta view
// (backend 000664, #2770) for browser screenshots. The meta view's reads are
// answered by scripts/e2e/mtg-format-meta-fixture.mjs from fixture-data.json,
// real rows read from cloud on 2026-11-19. Development only, behind the flag
// every e2e fixture uses.
export default function MtgFormatMetaFixturePage() {
  if (process.env.NODE_ENV === "production" || process.env.E2E_FIXTURES_ENABLED !== "1") {
    notFound();
  }
  return (
    <LanguageProvider>
      <MtgFormatMetaFixture />
    </LanguageProvider>
  );
}
