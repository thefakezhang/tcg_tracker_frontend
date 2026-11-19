import { notFound } from "next/navigation";
import { LanguageProvider } from "@/app/dashboard/LanguageContext";
import SalesTab from "@/app/dashboard/trip/SalesTab";

export const dynamic = "force-dynamic";

export default function SalesCsvFixturePage() {
  if (process.env.NODE_ENV === "production" || process.env.E2E_FIXTURES_ENABLED !== "1") {
    notFound();
  }
  return (
    <LanguageProvider>
      <main className="mx-auto min-h-screen w-full max-w-7xl p-4 sm:p-8">
        <SalesTab tripId={17} />
      </main>
    </LanguageProvider>
  );
}
