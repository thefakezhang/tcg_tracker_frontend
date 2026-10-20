"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, ImageIcon, LoaderCircle, RefreshCw, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation } from "@/lib/i18n";

export type ArrivalMedia = {
  source_image_index: number;
  source_image_url: string;
  content_sha256: string;
};

export type ArrivalPost = {
  arrival_key: string;
  buyer_handle: string;
  twitter_handle: string;
  tweet_id: string;
  tweet_url: string;
  tweet_created_at: string | null;
  acquired_at: string;
  unverified: true;
  media: ArrivalMedia[];
};

export type ArrivalPostsLoader = (buyerHandle: string) => Promise<ArrivalPost[]>;

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid arrival field: ${field}`);
  }
  return value;
}

function parseURL(value: unknown, field: string): string {
  const parsed = requiredString(value, field);
  let url: URL;
  try {
    url = new URL(parsed, "http://fixture.local");
  } catch {
    throw new Error(`Invalid arrival URL: ${field}`);
  }
  if (!["http:", "https:", "data:"].includes(url.protocol)) {
    throw new Error(`Invalid arrival URL scheme: ${field}`);
  }
  return parsed;
}

export function parseArrivalPosts(value: unknown): ArrivalPost[] {
  if (!Array.isArray(value)) throw new Error("Invalid arrival response");
  return value.map((raw, rowIndex) => {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Invalid arrival row: ${rowIndex}`);
    }
    const row = raw as Record<string, unknown>;
    for (const forbidden of ["item_identity", "price_jpy", "price_side", "grade", "condition"]) {
      if (forbidden in row) throw new Error(`Forbidden arrival field: ${forbidden}`);
    }
    if (row.unverified !== true || !Array.isArray(row.media) || row.media.length < 1) {
      throw new Error(`Invalid arrival evidence: ${rowIndex}`);
    }
    const tweetCreatedAt = row.tweet_created_at;
    if (tweetCreatedAt !== null && typeof tweetCreatedAt !== "string") {
      throw new Error(`Invalid arrival timestamp: ${rowIndex}`);
    }
    return {
      arrival_key: requiredString(row.arrival_key, "arrival_key"),
      buyer_handle: requiredString(row.buyer_handle, "buyer_handle"),
      twitter_handle: requiredString(row.twitter_handle, "twitter_handle"),
      tweet_id: requiredString(row.tweet_id, "tweet_id"),
      tweet_url: parseURL(row.tweet_url, "tweet_url"),
      tweet_created_at: tweetCreatedAt,
      acquired_at: requiredString(row.acquired_at, "acquired_at"),
      unverified: true,
      media: row.media.map((rawMedia, mediaIndex) => {
        if (rawMedia == null || typeof rawMedia !== "object" || Array.isArray(rawMedia)) {
          throw new Error(`Invalid arrival media: ${rowIndex}/${mediaIndex}`);
        }
        const media = rawMedia as Record<string, unknown>;
        const sourceImageIndex = media.source_image_index;
        if (!Number.isInteger(sourceImageIndex) || Number(sourceImageIndex) < 0) {
          throw new Error(`Invalid arrival media index: ${rowIndex}/${mediaIndex}`);
        }
        const digest = requiredString(media.content_sha256, "content_sha256");
        if (!/^[0-9a-f]{64}$/.test(digest)) {
          throw new Error(`Invalid arrival media digest: ${rowIndex}/${mediaIndex}`);
        }
        return {
          source_image_index: Number(sourceImageIndex),
          source_image_url: parseURL(media.source_image_url, "source_image_url"),
          content_sha256: digest,
        };
      }),
    };
  });
}

export const loadArrivalPosts: ArrivalPostsLoader = async (buyerHandle) => {
  const query = new URLSearchParams({ limit: "100" });
  if (buyerHandle) query.set("buyer_handle", buyerHandle);
  const response = await fetch(`/api/twitter-arrivals?${query}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = body != null && typeof body === "object"
      && "error" in body && typeof body.error === "string"
      ? body.error
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  if (body == null || typeof body !== "object" || !("posts" in body)) {
    throw new Error("Invalid arrival response");
  }
  return parseArrivalPosts(body.posts);
};

function previewURL(sourceURL: string): string {
  if (sourceURL.startsWith("data:") || sourceURL.startsWith("/")) return sourceURL;
  return `/api/proxy-image?url=${encodeURIComponent(sourceURL)}`;
}

export default function ArrivalPostsView({
  loader = loadArrivalPosts,
}: {
  loader?: ArrivalPostsLoader;
}) {
  const { t, language } = useTranslation();
  const [filterDraft, setFilterDraft] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [posts, setPosts] = useState<ArrivalPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (buyerHandle: string) => {
    setLoading(true);
    setError(null);
    try {
      setPosts(await loader(buyerHandle));
    } catch (reason) {
      setPosts([]);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [loader]);

  useEffect(() => {
    void load(activeFilter);
  }, [activeFilter, load]);

  const dateTime = useCallback((value: string | null, fallback: string) => {
    const parsed = new Date(value ?? fallback);
    if (Number.isNaN(parsed.getTime())) return t("arrivals.unknownTime");
    return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Tokyo",
    }).format(parsed);
  }, [language, t]);

  return (
    <section className="mx-auto w-full max-w-6xl min-w-0 space-y-4" aria-labelledby="arrival-posts-title">
      <div className="space-y-1">
        <h1 id="arrival-posts-title" className="text-xl font-semibold sm:text-2xl">
          {t("arrivals.title")}
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("arrivals.subtitle")}
        </p>
      </div>

      <form
        className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const next = filterDraft.trim();
          if (next === activeFilter) void load(next);
          else setActiveFilter(next);
        }}
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="arrival-shop-filter">{t("arrivals.shopFilter")}</Label>
          <Input
            id="arrival-shop-filter"
            className="h-11 sm:h-8"
            value={filterDraft}
            onChange={(event) => setFilterDraft(event.target.value)}
            placeholder={t("arrivals.shopFilterPlaceholder")}
            autoComplete="off"
          />
        </div>
        <Button type="submit" className="h-11 w-full sm:h-8 sm:w-auto" disabled={loading}>
          <Search aria-hidden="true" />
          {t("arrivals.applyFilter")}
        </Button>
      </form>

      {loading ? (
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          {t("arrivals.loading")}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4" role="alert">
          <p className="font-medium">{t("arrivals.errorTitle")}</p>
          <p className="mt-1 break-words text-sm text-muted-foreground">{error}</p>
          <Button className="mt-3 h-11 sm:h-8" variant="outline" onClick={() => void load(activeFilter)}>
            <RefreshCw aria-hidden="true" />
            {t("arrivals.retry")}
          </Button>
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="font-medium">{t("arrivals.emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("arrivals.emptyBody")}</p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-4 md:grid-cols-2" data-testid="arrival-post-list">
          {posts.map((post) => (
            <Card key={post.arrival_key} className="min-w-0" data-testid="arrival-post-card">
              <CardHeader>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <CardTitle className="min-w-0 break-words">{post.buyer_handle}</CardTitle>
                  <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200">
                    {t("arrivals.unverified")}
                  </Badge>
                </div>
                <CardDescription className="break-words">
                  @{post.twitter_handle} · {dateTime(post.tweet_created_at, post.acquired_at)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
                  {post.media.map((media) => (
                    <a
                      key={`${post.arrival_key}:${media.source_image_index}`}
                      href={media.source_image_url}
                      target="_blank"
                      rel="noreferrer"
                      className="group relative flex aspect-square min-h-24 min-w-0 items-center justify-center overflow-hidden rounded-lg border bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      aria-label={t("arrivals.openMedia", { number: media.source_image_index + 1 })}
                    >
                      <img
                        src={previewURL(media.source_image_url)}
                        alt={t("arrivals.mediaAlt", { number: media.source_image_index + 1, shop: post.buyer_handle })}
                        className="h-full w-full object-contain transition-transform group-hover:scale-[1.02]"
                        loading="lazy"
                      />
                      <span className="sr-only">{media.content_sha256}</span>
                    </a>
                  ))}
                </div>
                <a
                  href={post.tweet_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-auto"
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                  {t("arrivals.openSource")}
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {!loading && !error && posts.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="note">
          <ImageIcon className="size-4" aria-hidden="true" />
          {t("arrivals.evidenceNote")}
        </p>
      )}
    </section>
  );
}
