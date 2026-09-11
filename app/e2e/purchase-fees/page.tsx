import { notFound } from "next/navigation";
import { LanguageProvider } from "@/app/dashboard/LanguageContext";
import { TripProvider } from "@/app/dashboard/TripContext";
import { PurchaseFeeFixture } from "./PurchaseFeeFixture";

export const dynamic = "force-dynamic";

export default function PurchaseFeeFixturePage() {
  if (process.env.NODE_ENV === "production" || process.env.E2E_FIXTURES_ENABLED !== "1") {
    notFound();
  }
  return (
    <LanguageProvider>
      <TripProvider>
        <PurchaseFeeFixture />
      </TripProvider>
    </LanguageProvider>
  );
}
