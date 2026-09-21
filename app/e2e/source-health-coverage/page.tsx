import { notFound } from "next/navigation";
import { BuyListProvider } from "@/app/dashboard/BuyListContext";
import { LanguageProvider } from "@/app/dashboard/LanguageContext";
import { ReviewQueueNavigationProvider } from "@/app/dashboard/ReviewQueueNavigationContext";
import { TripProvider } from "@/app/dashboard/TripContext";
import { SourceHealthCoverageFixture } from "./SourceHealthCoverageFixture";

export const dynamic = "force-dynamic";

export default function SourceHealthCoverageFixturePage() {
  if (process.env.NODE_ENV === "production" || process.env.E2E_FIXTURES_ENABLED !== "1") {
    notFound();
  }

  return (
    <LanguageProvider defaultLanguage="en">
      <TripProvider>
        <BuyListProvider>
          <ReviewQueueNavigationProvider>
            <SourceHealthCoverageFixture />
          </ReviewQueueNavigationProvider>
        </BuyListProvider>
      </TripProvider>
    </LanguageProvider>
  );
}
