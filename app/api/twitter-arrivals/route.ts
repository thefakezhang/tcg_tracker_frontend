import { type NextRequest, NextResponse } from "next/server";

import { laterOf } from "@/lib/arrival-observed-at";
import { MAX_REGION_KEYS, REGION_RE } from "@/lib/arrival-region-key";
import { createClient } from "@/lib/supabase/server";

const MAX_LIMIT = 100;
const SAFE_FILTER = /^[^\u0000-\u001f\u007f]{1,100}$/;
const SAFE_CURSOR_KEY = /^[^\u0000-\u001f\u007f]{1,512}$/;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

// `last_boosted_at` is optional on the rows (older backends do not send it);
// present, it must be a timestamp or the cursor would be unstable.
function optionalTimestamp(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error("arrival RPC returned an invalid cursor boundary");
  }
  return value;
}

function nextCursor(rows: unknown[], limit: number) {
  if (rows.length < limit) return null;
  const last = rows.at(-1);
  if (last == null || typeof last !== "object" || Array.isArray(last)) {
    throw new Error("arrival RPC returned an invalid row");
  }
  const row = last as Record<string, unknown>;
  const base = row.tweet_created_at ?? row.acquired_at;
  if (typeof base !== "string" || Number.isNaN(Date.parse(base))
    || typeof row.arrival_key !== "string" || row.arrival_key.trim() === "") {
    throw new Error("arrival RPC returned an invalid cursor boundary");
  }
  // The RPC orders rows by the later of the tweet time and the last re-post,
  // so the cursor carries that same value; a row never re-posted is unchanged.
  return { before: laterOf(base, optionalTimestamp(row.last_boosted_at)), before_key: row.arrival_key };
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

  // The window's start, inclusive; the RPC compares it with the same observed
  // time it orders by, so a windowed page is never fetched then dropped.
  const rawSince = request.nextUrl.searchParams.get("since")?.trim() ?? "";
  if (rawSince && (rawSince.length > 64 || Number.isNaN(Date.parse(rawSince)))) {
    return badRequest("since must be an RFC 3339 timestamp");
  }

  // The posts of any of several regions: `regions=akihabara,fukuoka`, and the
  // single `region=fukuoka` of links from before the filter took several,
  // both sent as p_regions (never p_region). The argument is sent only when a
  // region is asked for, so every request without one keeps working against a
  // backend from before the region filter.
  const regions = new Set<string>();
  for (const name of ["regions", "region"]) {
    const raw = request.nextUrl.searchParams.get(name)?.trim() ?? "";
    if (!raw) continue;
    for (const part of raw.split(",")) {
      const key = part.trim();
      if (!REGION_RE.test(key)) {
        return badRequest(`${name} must be comma-separated region keys`);
      }
      regions.add(key);
    }
  }
  if (regions.size > MAX_REGION_KEYS) {
    return badRequest(`regions may name at most ${MAX_REGION_KEYS} regions`);
  }

  const { data, error } = await supabase.rpc("twitter_arrival_posts", {
    p_buyer_handle: rawBuyer || null,
    p_before: rawBefore || null,
    p_before_key: rawBeforeKey || null,
    p_limit: limit,
    p_since: rawSince || null,
    ...(regions.size > 0 ? { p_regions: [...regions].sort() } : {}),
  });
  if (error) {
    const forbidden = error.code === "42501"
      || error.message.includes("requires an administrator");
    if (forbidden) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // The backend's refusal of an argument it understood (a malformed region
    // or too many of them); its message is written for the operator.
    if (error.code === "22023") {
      return badRequest(error.message);
    }
    return NextResponse.json({ error: "Arrival posts are unavailable" }, { status: 500 });
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
