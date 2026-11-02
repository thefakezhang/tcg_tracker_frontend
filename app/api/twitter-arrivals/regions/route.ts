import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

// The Arrivals focus regions and read-once requests (backend #2342,
// migration 000622). Same boundary as ../route.ts: the caller's session goes
// to the administrator-only backend RPCs, nothing is read or written
// directly, no service key is involved, and the answer is never cached.
// GET is the status; POST changes the focus or asks for a region to be read
// once, and answers with the status after the change.

const UNAVAILABLE = "Region controls are unavailable";
const REGION_RE = /^[a-z][a-z0-9_]{0,39}$/;
const TOKYO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NO_STORE = { "cache-control": "private, no-store" };

// What PostgREST and Postgres answer while the RPCs are not applied yet. The
// route reports that as 501, and the tab says the controls wait for the
// backend migration rather than showing them as broken.
function rpcMissing(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST202"
    || error.code === "42883"
    || /could not find the function/i.test(error.message ?? "");
}

type RpcCall = { name: string; args: Record<string, string | null> };

function rpcFor(body: unknown): RpcCall | string {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return "a JSON object is required";
  }
  const { action, region, until } = body as Record<string, unknown>;
  if (action === "reset_focus") {
    return { name: "twitter_arrivals_clear_focus", args: { p_region: null } };
  }
  if (typeof region !== "string" || !REGION_RE.test(region)) {
    return "region must be a region key";
  }
  switch (action) {
    case "set_focus":
      if (until !== null && (typeof until !== "string" || !TOKYO_DATE_RE.test(until))) {
        return "until must be a YYYY-MM-DD Tokyo date or null";
      }
      return { name: "twitter_arrivals_set_focus", args: { p_region: region, p_until: until } };
    case "clear_focus":
      return { name: "twitter_arrivals_clear_focus", args: { p_region: region } };
    case "request_read":
      return { name: "twitter_arrivals_request_read", args: { p_region: region } };
    default:
      return "action must be set_focus, clear_focus, reset_focus or request_read";
  }
}

function rpcError(error: { code?: string; message: string }) {
  if (error.code === "42501" || error.message.includes("requires an administrator")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (rpcMissing(error)) {
    return NextResponse.json({ error: UNAVAILABLE, reason: "rpc-missing" }, { status: 501 });
  }
  // The backend's own refusal of a request it understood (an unknown region,
  // a date out of range, a region already in focus or with no readable
  // list): its message is written for the operator.
  if (error.code === "22023") {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: UNAVAILABLE }, { status: 500 });
}

async function authorized() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? supabase : null;
}

export async function GET() {
  const supabase = await authorized();
  if (!supabase) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabase.rpc("twitter_arrivals_focus_status");
  if (error) return rpcError(error);
  return NextResponse.json({ status: data }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const supabase = await authorized();
  if (!supabase) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as unknown;
  const call = rpcFor(body);
  if (typeof call === "string") return NextResponse.json({ error: call }, { status: 400 });
  const { data, error } = await supabase.rpc(call.name, call.args);
  if (error) return rpcError(error);
  return NextResponse.json({ status: data }, { headers: NO_STORE });
}
