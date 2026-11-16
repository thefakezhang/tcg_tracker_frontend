import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

import { LEAD_COLUMNS, groupArgs, nextCursor, parseLeadGroups, parseLeadsRequest } from "./leads-query";

// The Mercari leads feed reads the backend view mercari_leads_v under the
// caller's own session. The view sits on the cloud publication of title-first
// leads from the acquisition host (backend migration 000616,
// cmd/util/publish-mercari-leads). It is security_invoker, so row-level
// security applies and only an active source-run operator sees rows; the route
// asks that predicate first so a non-operator gets a clear 403 instead of an
// empty page.
//
// Since backend 000638 (#2517) the feed is grouped: copies of one card at one
// holder or grade are one row, the group's best row under the sort, with the
// group's row count, listing count, ask range and members. The grouped feed is
// the SECURITY INVOKER function mercari_lead_groups, which filters, groups and
// keyset-pages on the representative (one lane and one format per request, so
// lanes never mix and an auction is never ranked against a fixed-price lead,
// #2436); the representatives are then read in full from the view, which a
// page bounds to at most 100 rows. ?ids= reads a group's members in full, in
// the order given, when the tab expands it.
//
// Since backend 000646 (#2707, #2708) the slab_play lane gathers the raw
// leads whose card's Card Ladder PSA 1-6 floor clears the ask after grading,
// and every feed takes a seller-condition filter and a condition sort.

function unavailable() {
  return NextResponse.json({ error: "Mercari leads are unavailable" }, { status: 500 });
}

const NO_STORE = { "cache-control": "private, no-store" };

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
  const leadsRequest = parsed.value;

  const { data: operator, error: operatorError } = await supabase.rpc("source_run_is_operator");
  if (operatorError) return unavailable();
  if (operator !== true) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // A row lane reads its own rows; the slab plays read the rows of any raw
  // lane that carry a slab play (backend 000646), which is what the grouped
  // feed and its members are drawn from.
  const readRows = async (ids: string[]) => {
    const view = supabase.from("mercari_leads_v").select(LEAD_COLUMNS);
    const scoped = leadsRequest.lane === "slab_play"
      ? view.not("slab_play_state", "is", null)
      : view.eq("lane", leadsRequest.lane);
    const { data, error } = await scoped.in("external_item_id", ids);
    if (error) return null;
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      if (typeof row.external_item_id === "string") byId.set(row.external_item_id, row);
    }
    return byId;
  };

  // A group's members, for an expansion. A member a publication retired since
  // the group was read is simply absent.
  if (leadsRequest.ids) {
    const byId = await readRows(leadsRequest.ids);
    if (!byId) return unavailable();
    const leads = leadsRequest.ids.flatMap((id) => byId.get(id) ?? []);
    return NextResponse.json({ leads, next_cursor: null }, { headers: NO_STORE });
  }

  const { data: groupData, error: groupError } = await supabase.rpc("mercari_lead_groups", groupArgs(leadsRequest));
  if (groupError) return unavailable();
  try {
    const groups = parseLeadGroups(groupData ?? []);
    const byId = groups.length > 0 ? await readRows(groups.map((group) => group.external_item_id)) : new Map();
    if (!byId) return unavailable();
    // A representative a publication retired between the two reads is
    // absent; the cursor still comes from the groups, so no group is skipped.
    const leads = groups.flatMap((group) => {
      const row = byId.get(group.external_item_id);
      return row
        ? [{
          ...row,
          group_rows: group.group_rows,
          group_listings: group.group_listings,
          group_ask_min_jpy: group.group_ask_min_jpy,
          group_ask_max_jpy: group.group_ask_max_jpy,
          group_member_ids: group.group_member_ids,
        }]
        : [];
    });
    return NextResponse.json(
      { leads, next_cursor: nextCursor(groups, leadsRequest.limit, leadsRequest.sort, leadsRequest.lane) },
      { headers: NO_STORE },
    );
  } catch {
    return unavailable();
  }
}
