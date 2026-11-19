import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decideProxyUrl } from "@/lib/proxy-image-policy";

// Only the dashboard's buy-list export calls this. Without an auth check it is
// an open proxy on a public origin: anyone could make our server fetch an
// arbitrary URL (an internal-port oracle via the 502/500 split) and serve
// arbitrary bytes from our domain on our bandwidth. Gate it like
// /api/aggregate-prices does - middleware only guards /dashboard, not /api.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const decision = decideProxyUrl(request.nextUrl.searchParams.get("url"));
  if (!decision.ok) {
    return NextResponse.json({ error: decision.reason }, { status: 400 });
  }

  try {
    let target = decision.url;
    const signal = AbortSignal.timeout(10_000);
    let res = await fetch(target, { redirect: "manual", signal });
    // Every hop uses the same policy and deadline as the original request.
    for (let redirects = 0; REDIRECT_STATUSES.has(res.status); redirects++) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location || redirects >= 5) {
        return NextResponse.json({ error: "Invalid upstream redirect" }, { status: 502 });
      }
      const next = decideProxyUrl(new URL(location, target).href);
      if (!next.ok) {
        return NextResponse.json({ error: next.reason }, { status: 400 });
      }
      target = next.url;
      res = await fetch(target, { redirect: "manual", signal });
    }
    if (!res.ok) {
      return NextResponse.json({ error: "Upstream error" }, { status: 502 });
    }
    const contentType = res.headers.get("content-type") || "image/png";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "Not an image" }, { status: 400 });
    }
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "Too large" }, { status: 413 });
    }
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

const MAX_BYTES = 8 * 1024 * 1024;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
