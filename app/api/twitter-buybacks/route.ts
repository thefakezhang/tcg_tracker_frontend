import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { NO_STORE, buybackForbidden, buybackRpcMissing } from "./rpc-errors";

// The Buybacks tab overview (backend #2392, migration 000628): every Twitter
// buyback source with its freshness, latest sheet, live bids and auto-accept
// state. Same boundary as /api/twitter-arrivals: the caller's session goes to
// the administrator-only backend RPC, nothing is read directly, no service key
// is involved, and the answer is never cached.

const UNAVAILABLE = "Buyback sources are unavailable";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("twitter_buyback_sources");
  if (error) {
    if (buybackForbidden(error)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (buybackRpcMissing(error)) {
      return NextResponse.json({ error: UNAVAILABLE, reason: "rpc-missing" }, { status: 501 });
    }
    return NextResponse.json({ error: UNAVAILABLE }, { status: 500 });
  }
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ error: UNAVAILABLE }, { status: 500 });
  }
  return NextResponse.json({ overview: data }, { headers: NO_STORE });
}
