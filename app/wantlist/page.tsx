import type { Metadata } from "next";
import WantList, { type Card } from "./WantList";
import cards from "@/lib/wantlist/cards.json";

// Fully static: the list is baked in at build time, so this page makes no
// runtime database call and needs no Supabase key. Regenerate by replacing
// lib/wantlist/cards.json and the matching images in public/wantlist.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "仕入希望カードリスト | Japan Singles Want List",
  description: "日本国内で探しているポケモンカードシングルの一覧。",
};

const UPDATED = "2026-08-24";

export default function WantListPage() {
  return <WantList cards={cards as Card[]} updated={UPDATED} />;
}
