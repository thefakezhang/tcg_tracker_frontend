import { notFound } from "next/navigation";
import { BuyerShell } from "@/app/dashboard/BuyerShell";

export const dynamic = "force-dynamic";

export default function BuyerResultGridFixturePage() {
  if (process.env.NODE_ENV === "production" || process.env.E2E_FIXTURES_ENABLED !== "1") {
    notFound();
  }
  return <BuyerShell email="buyer.fixture@example.test" viewingAs />;
}
