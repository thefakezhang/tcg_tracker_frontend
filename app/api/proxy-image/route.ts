import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decideProxyUrl } from "@/lib/proxy-image-policy";

// Fetches a card image on behalf of the buy-list export (cross-origin images
// cannot be rasterised from the browser). Two guards, both audit findings:
//   - a session is required: the middleware only protects /dashboard, so this
//     route used to be an anonymous open proxy;
//   - only http(s) to public hosts (lib/proxy-image-policy), so it cannot be
//     pointed at loopback / private / metadata addresses.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const decision = decideProxyUrl(request.nextUrl.searchParams.get("url"));
  if (!decision.ok) {
    return NextResponse.json({ error: decision.reason }, { status: 400 });
  }

  try {
    const res = await fetch(decision.url, { redirect: "manual" });
    if (!res.ok) {
      return NextResponse.json({ error: "Upstream error" }, { status: 502 });
    }
    const contentType = res.headers.get("content-type") || "image/png";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "Not an image" }, { status: 400 });
    }
    const buffer = await res.arrayBuffer();
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
