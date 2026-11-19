import { notFound } from "next/navigation";
import { LanguageProvider } from "@/app/dashboard/LanguageContext";
import { LotPickerProvider } from "@/app/dashboard/LotPickerContext";
import LotLoadFixture from "./LotLoadFixture";

export const dynamic = "force-dynamic";

export default function LotLoadFixturePage() {
  if (process.env.NODE_ENV === "production" || process.env.E2E_FIXTURES_ENABLED !== "1") notFound();
  return <LanguageProvider><LotPickerProvider><LotLoadFixture /></LotPickerProvider></LanguageProvider>;
}
