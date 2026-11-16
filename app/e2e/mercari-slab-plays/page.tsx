import { notFound } from "next/navigation";
import { LanguageProvider } from "@/app/dashboard/LanguageContext";
import { MercariSlabPlaysFixture } from "./MercariSlabPlaysFixture";

export const dynamic = "force-dynamic";

// A controlled render of the Mercari leads tab's slab plays and condition
// filter (backend 000646, #2707, #2708) for browser screenshots, with fixed
// leads in place of the cloud read. Development only, behind the flag every
// e2e fixture uses.
export default function MercariSlabPlaysFixturePage() {
  if (process.env.NODE_ENV === "production" || process.env.E2E_FIXTURES_ENABLED !== "1") {
    notFound();
  }
  return (
    <LanguageProvider>
      <MercariSlabPlaysFixture />
    </LanguageProvider>
  );
}
