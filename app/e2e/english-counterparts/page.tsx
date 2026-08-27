import { notFound } from "next/navigation";
import { LanguageProvider } from "@/app/dashboard/LanguageContext";
import { EnglishCounterpartFixture } from "./EnglishCounterpartFixture";

export const dynamic = "force-dynamic";

export default function EnglishCounterpartFixturePage() {
  if (process.env.NODE_ENV === "production" || process.env.E2E_FIXTURES_ENABLED !== "1") {
    notFound();
  }
  return (
    <LanguageProvider>
      <EnglishCounterpartFixture />
    </LanguageProvider>
  );
}
