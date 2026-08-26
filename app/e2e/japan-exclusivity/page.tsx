import { notFound } from "next/navigation";
import { LanguageProvider } from "@/app/dashboard/LanguageContext";
import { JapanExclusivityFixture } from "./JapanExclusivityFixture";

export const dynamic = "force-dynamic";

export default function JapanExclusivityFixturePage() {
  if (process.env.NODE_ENV === "production" || process.env.E2E_FIXTURES_ENABLED !== "1") {
    notFound();
  }
  return (
    <LanguageProvider>
      <JapanExclusivityFixture />
    </LanguageProvider>
  );
}
