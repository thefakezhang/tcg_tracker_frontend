import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

import { LEAD_COLUMNS, nextCursor, parseLeadsRequest } from "./leads-query";

// The Mercari leads feed reads the backend view mercari_leads_v under the
// caller's own session. The view sits on the cloud publication of title-first
// leads from the acquisition host (backend migration 000616,
// cmd/util/publish-mercari-leads). It is security_invoker, so row-level
// security applies and only an active source-run operator sees rows; the route
// asks that predicate first so a non-operator gets a clear 403 instead of an
// empty page.
//
// One lane per request, so lanes never mix. Both sorts are keysets on the
// table's indexes, (lane, multiple DESC NULLS LAST, external_item_id) and
// (lane, first_seen_at DESC, external_item_id): the lane is an equality and
// the order is exactly the index order.

function unavailable() {
  return NextResponse.json({ error: "Mercari leads are unavailable" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = parseLeadsRequest(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { lane, sort, photo, includeDismissed, includeUnavailable, cursor, limit } = parsed.value;

  const { data: operator, error: operatorError } = await supabase.rpc("source_run_is_operator");
  if (operatorError) return unavailable();
  if (operator !== true) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let query = supabase
    .from("mercari_leads_v")
    .select(LEAD_COLUMNS)
    .eq("lane", lane);
  query = sort === "multiple"
    ? query.order("multiple", { ascending: false, nullsFirst: false })
    : query.order("first_seen_at", { ascending: false });
  query = query.order("external_item_id", { ascending: true }).limit(limit);

  // Hidden by default: a listing no longer on sale, a photo check that rejected
  // it, and a lead the operator dismissed.
  if (!includeUnavailable) query = query.eq("source_status", "ON_SALE");
  query = photo ? query.eq("photo_check_state", photo) : query.neq("photo_check_state", "rejected");
  if (!includeDismissed) query = query.eq("dismissed", false);

  if (cursor) {
    const { after, after_key: afterKey } = cursor;
    if (sort === "newest") {
      query = query.or(
        `first_seen_at.lt.${after},and(first_seen_at.eq.${after},external_item_id.gt.${afterKey})`,
      );
    } else if (after === null) {
      // The page ended inside the rows without a multiple, which sort last.
      query = query.is("multiple", null).gt("external_item_id", afterKey);
    } else {
      query = query.or(
        `multiple.lt.${after},and(multiple.eq.${after},external_item_id.gt.${afterKey}),multiple.is.null`,
      );
    }
  }

  const { data, error } = await query;
  if (error) return unavailable();

  const leads = data ?? [];
  try {
    return NextResponse.json(
      { leads, next_cursor: nextCursor(leads, limit, sort) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch {
    return unavailable();
  }
}
