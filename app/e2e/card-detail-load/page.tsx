import { notFound } from "next/navigation";
import { CardDetailLoadFixture } from "./CardDetailLoadFixture";

export const dynamic = "force-dynamic";

export default function CardDetailLoadFixturePage() {
  if (process.env.NODE_ENV === "production" || process.env.E2E_FIXTURES_ENABLED !== "1") notFound();
  return <CardDetailLoadFixture />;
}
