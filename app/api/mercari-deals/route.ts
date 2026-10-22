import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

import { DEAL_COLUMNS, MAX_LIMIT, SAFE_ITEM_ID, nextCursor } from "./deals-query";

// The Mercari deals tab reads the backend view mercari_published_deals_v under
// the caller's own session. That view sits on the cloud publication of the
// acquisition host's deal rows (backend migration 000596), because the Mercari
// pipeline itself writes only to the acquisition host's local catalog. It is
// security_invoker, so row-level security applies: only an active source-run
// operator sees rows. The route asks that predicate first so a non-operator
// gets a clear 403 instead of an empty page.

const DEFAULT_LIMIT = 50;
const HOLDERS = new Set(["raw", "graded"]);
const LANES = new Set(["strict", "candidate"]);
// RFC 3339 as PostgREST emits it; no commas or parentheses, which would break
// the "or" filter grammar.
const SAFE_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+\-Z]{8,30}$/;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function unavailable() {
  return NextResponse.json({ error: "Mercari deals are unavailable" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const holder = params.get("holder")?.trim() ?? "";
  if (holder && !HOLDERS.has(holder)) {
    return badRequest("holder must be raw or graded");
  }
  const lane = params.get("lane")?.trim() ?? "";
  if (lane && !LANES.has(lane)) {
    return badRequest("lane must be strict or candidate");
  }
  const rawDismissed = params.get("include_dismissed")?.trim() ?? "";
  if (rawDismissed && rawDismissed !== "1" && rawDismissed !== "true") {
    return badRequest("include_dismissed must be 1 or true");
  }
  const includeDismissed = rawDismissed !== "";

  const before = params.get("before")?.trim() ?? "";
  if (before && (!SAFE_TIMESTAMP.test(before) || Number.isNaN(Date.parse(before)))) {
    return badRequest("before must be an RFC 3339 timestamp");
  }
  const beforeKey = params.get("before_key")?.trim() ?? "";
  if (beforeKey && !SAFE_ITEM_ID.test(beforeKey)) {
    return badRequest("before_key is invalid");
  }
  if (Boolean(before) !== Boolean(beforeKey)) {
    return badRequest("before and before_key must be provided together");
  }

  const rawLimit = params.get("limit")?.trim() ?? String(DEFAULT_LIMIT);
  if (!/^\d{1,3}$/.test(rawLimit)) {
    return badRequest("limit must be an integer between 1 and 100");
  }
  const limit = Number(rawLimit);
  if (limit < 1 || limit > MAX_LIMIT) {
    return badRequest("limit must be an integer between 1 and 100");
  }

  const { data: operator, error: operatorError } = await supabase.rpc("source_run_is_operator");
  if (operatorError) return unavailable();
  if (operator !== true) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let query = supabase
    .from("mercari_published_deals_v")
    .select(DEAL_COLUMNS)
    .order("observed_at", { ascending: false })
    .order("external_item_id", { ascending: true })
    .limit(limit);
  if (holder) query = query.eq("holder_kind", holder);
  if (lane) query = query.eq("evidence_lane", lane);
  if (!includeDismissed) {
    query = query.or("latest_item_action.is.null,latest_item_action.neq.dismissed");
  }
  if (before) {
    query = query.or(
      `observed_at.lt.${before},and(observed_at.eq.${before},external_item_id.gt.${beforeKey})`,
    );
  }

  const { data, error } = await query;
  if (error) return unavailable();

  const deals = data ?? [];
  try {
    return NextResponse.json(
      { deals, next_cursor: nextCursor(deals, limit) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch {
    return unavailable();
  }
}
