import { notFound } from "next/navigation";
import { BuyListProvider } from "@/app/dashboard/BuyListContext";
import { CurrencyProvider } from "@/app/dashboard/CurrencyContext";
import { HeaderProvider } from "@/app/dashboard/HeaderContext";
import { LanguageProvider } from "@/app/dashboard/LanguageContext";
import { TripProvider } from "@/app/dashboard/TripContext";
import { SealedBulkFixture } from "./SealedBulkFixture";

export const dynamic = "force-dynamic";

export default function SealedBulkFixturePage() {
  if (process.env.NODE_ENV === "production" || process.env.E2E_FIXTURES_ENABLED !== "1") {
    notFound();
  }
  return (
    <LanguageProvider>
      <CurrencyProvider>
        <TripProvider>
          <BuyListProvider>
            <HeaderProvider>
              <SealedBulkFixture />
            </HeaderProvider>
          </BuyListProvider>
        </TripProvider>
      </CurrencyProvider>
    </LanguageProvider>
  );
}
