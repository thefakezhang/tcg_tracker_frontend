import { notFound } from "next/navigation";
import { BuyListProvider } from "@/app/dashboard/BuyListContext";
import { CurrencyProvider } from "@/app/dashboard/CurrencyContext";
import { ExitBasisProvider } from "@/app/dashboard/ExitBasisContext";
import { GameProvider } from "@/app/dashboard/GameContext";
import { HeaderProvider } from "@/app/dashboard/HeaderContext";
import { LanguageProvider } from "@/app/dashboard/LanguageContext";
import { LotPickerProvider } from "@/app/dashboard/LotPickerContext";
import { ReviewQueueNavigationProvider } from "@/app/dashboard/ReviewQueueNavigationContext";
import { TripProvider } from "@/app/dashboard/TripContext";
import { PokemonVariantProjectionFixture } from "./PokemonVariantProjectionFixture";

export const dynamic = "force-dynamic";

export default function PokemonVariantProjectionFixturePage() {
  if (process.env.NODE_ENV === "production" || process.env.E2E_FIXTURES_ENABLED !== "1") {
    notFound();
  }

  return (
    <LanguageProvider>
      <CurrencyProvider>
        <GameProvider>
          <ExitBasisProvider>
            <TripProvider>
              <BuyListProvider>
                <ReviewQueueNavigationProvider>
                  <LotPickerProvider>
                    <HeaderProvider>
                      <PokemonVariantProjectionFixture />
                    </HeaderProvider>
                  </LotPickerProvider>
                </ReviewQueueNavigationProvider>
              </BuyListProvider>
            </TripProvider>
          </ExitBasisProvider>
        </GameProvider>
      </CurrencyProvider>
    </LanguageProvider>
  );
}
