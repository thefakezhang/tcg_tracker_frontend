import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

// Per-account summary of the Twitter arrival posts, for the account panel of
// the Arrivals tab. Same boundary as ../route.ts: the caller's session goes to
// the administrator-only backend RPC, nothing is read directly, no service key
// is involved, and the answer is never cached.

const UNAVAILABLE = "Arrival accounts are unavailable";

// What PostgREST and Postgres answer while the RPC is not applied yet: the
// schema-cache miss and undefined_function. The route reports that as 501 so
// the browser derives the account list from the posts it already has instead
// of showing the panel as broken until the backend migration lands.
function rpcMissing(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST202"
    || error.code === "42883"
    || /could not find the function/i.test(error.message ?? "");
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawSince = request.nextUrl.searchParams.get("since")?.trim() ?? "";
  if (rawSince && (rawSince.length > 64 || Number.isNaN(Date.parse(rawSince)))) {
    return NextResponse.json({ error: "since must be an RFC 3339 timestamp" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("twitter_arrival_sources", {
    p_since: rawSince || null,
  });
  if (error) {
    const forbidden = error.code === "42501"
      || error.message.includes("requires an administrator");
    if (forbidden) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (rpcMissing(error)) {
      return NextResponse.json({ error: UNAVAILABLE, reason: "rpc-missing" }, { status: 501 });
    }
    return NextResponse.json({ error: UNAVAILABLE }, { status: 500 });
  }

  return NextResponse.json(
    { sources: data ?? [] },
    { headers: { "cache-control": "private, no-store" } },
  );
}
