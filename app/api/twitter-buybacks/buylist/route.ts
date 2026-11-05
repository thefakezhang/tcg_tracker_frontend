import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { NO_STORE, buybackForbidden, buybackRpcMissing } from "../rpc-errors";

// One source's latest buylist for the Buybacks tab (backend #2392, migration
// 000628): one row per card and grade at its most recent quote. Same boundary
// as ../route.ts.

const UNAVAILABLE = "The buylist is unavailable";
// The bound the backend puts on a source handle, and the one the Arrivals
// route puts on buyer_handle: 1-100 visible characters.
const SAFE_SOURCE = /^[^\u0000-\u001f\u007f]{1,100}$/;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const source = request.nextUrl.searchParams.get("source")?.trim() ?? "";
  if (!SAFE_SOURCE.test(source)) {
    return NextResponse.json({ error: "source must be a buyback source handle" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("twitter_buyback_buylist", { p_source: source });
  if (error) {
    if (buybackForbidden(error)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (buybackRpcMissing(error)) {
      return NextResponse.json({ error: UNAVAILABLE, reason: "rpc-missing" }, { status: 501 });
    }
    // The backend's own refusal of a handle it understood is written for the operator.
    if (error.code === "22023") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: UNAVAILABLE }, { status: 500 });
  }
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ error: UNAVAILABLE }, { status: 500 });
  }
  return NextResponse.json({ buylist: data }, { headers: NO_STORE });
}
