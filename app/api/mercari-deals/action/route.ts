import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

// Records an operator action on one exact Mercari listing through the backend
// RPC record_mercari_deal_item_action, which enforces the operator role, the
// allowed actions, and the dismissal-needs-a-reason rule itself. The route only
// bounds the input and maps the RPC's refusals to HTTP statuses.

const ACTIONS = new Set(["dismissed", "recheck_requested"]);
const SAFE_ITEM_ID = /^(m[0-9]{9,11}|[A-Za-z0-9]{20,32})$/;
const MAX_REASON = 500;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as unknown;
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("body must be a JSON object");
  }
  const { external_item_id: rawId, action: rawAction, reason: rawReason } = body as Record<string, unknown>;
  if (typeof rawId !== "string" || !SAFE_ITEM_ID.test(rawId)) {
    return badRequest("external_item_id is invalid");
  }
  if (typeof rawAction !== "string" || !ACTIONS.has(rawAction)) {
    return badRequest("action must be dismissed or recheck_requested");
  }
  if (rawReason != null && typeof rawReason !== "string") {
    return badRequest("reason must be a string");
  }
  const reason = (rawReason ?? "").trim();
  if (reason.length > MAX_REASON) {
    return badRequest("reason is too long");
  }
  if (rawAction === "dismissed" && reason === "") {
    return badRequest("a dismissal requires a reason");
  }

  const { data, error } = await supabase.rpc("record_mercari_deal_item_action", {
    p_external_item_id: rawId,
    p_action: rawAction,
    p_reason: reason || null,
  });
  if (error) {
    if (error.message.includes("require an active source-run operator")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error.message.includes("does not exist")) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }
    if (error.code === "23514") {
      return NextResponse.json({ error: "Listing id is outside the recorded shape" }, { status: 409 });
    }
    return NextResponse.json({ error: "The action could not be recorded" }, { status: 500 });
  }
  return NextResponse.json(
    { action: data },
    { headers: { "cache-control": "private, no-store" } },
  );
}
