"use client";

import { useCallback, useState } from "react";

import ArrivalPostsView, {
  type ArrivalPost,
  type ArrivalPostsLoader,
} from "@/app/dashboard/ArrivalPostsView";
import { Button } from "@/components/ui/button";

type Scenario = "loaded" | "empty" | "error" | "unauthorized";

function mediaData(label: string, color: string, width: number, height: number): string {
  const inset = Math.round(Math.min(width, height) * 0.08);
  const centerX = width / 2;
  const centerY = height / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${color}"/><rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}" rx="22" fill="white" opacity=".94"/><text x="${centerX}" y="${centerY - 18}" text-anchor="middle" font-family="sans-serif" font-size="34" font-weight="700" fill="#172033">${label}</text><text x="${centerX}" y="${centerY + 32}" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#526070">Controlled arrival evidence</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const POSTS: ArrivalPost[] = [
  {
    arrival_key: "tcgshop_alice:2112064092735521045",
    buyer_handle: "alice",
    twitter_handle: "TCGshop_alice",
    tweet_id: "2112064092735521045",
    tweet_url: "https://x.com/TCGshop_alice/status/2112064092735521045",
    tweet_created_at: "2026-10-20T10:08:00+09:00",
    acquired_at: "2026-10-20T10:09:12+09:00",
    unverified: true,
    media: [
      { source_image_index: 0, source_image_url: mediaData("Alice landscape", "#dce9ff", 800, 450), content_sha256: "1".repeat(64) },
      { source_image_index: 1, source_image_url: mediaData("Alice portrait", "#eadcff", 480, 720), content_sha256: "2".repeat(64) },
    ],
  },
  {
    arrival_key: "cardrush_online:2111793426450764272",
    buyer_handle: "cardrush-online",
    twitter_handle: "cardrush_online",
    tweet_id: "2111793426450764272",
    tweet_url: "https://x.com/cardrush_online/status/2111793426450764272",
    tweet_created_at: "2026-10-20T11:22:00+09:00",
    acquired_at: "2026-10-20T11:23:05+09:00",
    unverified: true,
    media: [
      { source_image_index: 0, source_image_url: mediaData("Cardrush arrivals", "#dff6e7", 640, 480), content_sha256: "3".repeat(64) },
    ],
  },
  {
    arrival_key: "ds_akiba_pokeca:2108446937514938625",
    buyer_handle: "dragon-star-akiba",
    twitter_handle: "ds_akiba_pokeca",
    tweet_id: "2108446937514938625",
    tweet_url: "https://x.com/ds_akiba_pokeca/status/2108446937514938625",
    tweet_created_at: null,
    acquired_at: "2026-10-20T12:05:00+09:00",
    unverified: true,
    media: [
      { source_image_index: 0, source_image_url: mediaData("Akiba showcase", "#fff1d6", 640, 480), content_sha256: "4".repeat(64) },
    ],
  },
];

export function TwitterArrivalsFixture() {
  const [scenario, setScenario] = useState<Scenario>("loaded");
  const loader = useCallback<ArrivalPostsLoader>(async (buyerHandle) => {
    if (scenario === "error") throw new Error("Controlled arrival API failure");
    if (scenario === "unauthorized") throw new Error("Forbidden");
    if (scenario === "empty") return { posts: [], nextCursor: null };
    return {
      posts: buyerHandle
        ? POSTS.filter((post) => post.buyer_handle === buyerHandle)
        : POSTS,
      nextCursor: null,
    };
  }, [scenario]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl overflow-x-hidden p-3 sm:p-8" data-testid="twitter-arrivals-fixture">
      <header className="mb-4 space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Controlled browser fixture
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Arrival response scenario">
          {(["loaded", "empty", "error", "unauthorized"] as const).map((value) => (
            <Button
              key={value}
              className="h-11 sm:h-8"
              variant={scenario === value ? "default" : "outline"}
              aria-pressed={scenario === value}
              onClick={() => setScenario(value)}
            >
              {value}
            </Button>
          ))}
        </div>
      </header>
      <ArrivalPostsView loader={loader} />
    </main>
  );
}
