import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const MAX_LIMIT = 100;
const SAFE_FILTER = /^[^\u0000-\u001f\u007f]{1,100}$/;
const SAFE_CURSOR_KEY = /^[^\u0000-\u001f\u007f]{1,512}$/;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function nextCursor(rows: unknown[], limit: number) {
  if (rows.length < limit) return null;
  const last = rows.at(-1);
  if (last == null || typeof last !== "object" || Array.isArray(last)) {
    throw new Error("arrival RPC returned an invalid row");
  }
  const row = last as Record<string, unknown>;
  const before = row.tweet_created_at ?? row.acquired_at;
  if (typeof before !== "string" || Number.isNaN(Date.parse(before))
    || typeof row.arrival_key !== "string" || row.arrival_key.trim() === "") {
    throw new Error("arrival RPC returned an invalid cursor boundary");
  }
  return { before, before_key: row.arrival_key };
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBuyer = request.nextUrl.searchParams.get("buyer_handle")?.trim() ?? "";
  if (rawBuyer && !SAFE_FILTER.test(rawBuyer)) {
    return badRequest("buyer_handle is invalid");
  }

  const rawBefore = request.nextUrl.searchParams.get("before")?.trim() ?? "";
  if (rawBefore && (rawBefore.length > 64 || Number.isNaN(Date.parse(rawBefore)))) {
    return badRequest("before must be an RFC 3339 timestamp");
  }
  const rawBeforeKey = request.nextUrl.searchParams.get("before_key")?.trim() ?? "";
  if (rawBeforeKey && !SAFE_CURSOR_KEY.test(rawBeforeKey)) {
    return badRequest("before_key is invalid");
  }
  if (Boolean(rawBefore) !== Boolean(rawBeforeKey)) {
    return badRequest("before and before_key must be provided together");
  }

  const rawLimit = request.nextUrl.searchParams.get("limit")?.trim() ?? "50";
  if (!/^\d{1,3}$/.test(rawLimit)) {
    return badRequest("limit must be an integer between 1 and 100");
  }
  const limit = Number(rawLimit);
  if (limit < 1 || limit > MAX_LIMIT) {
    return badRequest("limit must be an integer between 1 and 100");
  }

  const { data, error } = await supabase.rpc("twitter_arrival_posts", {
    p_buyer_handle: rawBuyer || null,
    p_before: rawBefore || null,
    p_before_key: rawBeforeKey || null,
    p_limit: limit,
  });
  if (error) {
    const forbidden = error.code === "42501"
      || error.message.includes("requires an administrator");
    return NextResponse.json(
      { error: forbidden ? "Forbidden" : "Arrival posts are unavailable" },
      { status: forbidden ? 403 : 500 },
    );
  }

  const posts = data ?? [];
  try {
    return NextResponse.json(
      { posts, next_cursor: nextCursor(posts, limit) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Arrival posts are unavailable" },
      { status: 500 },
    );
  }
}
