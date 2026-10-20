import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { allowLocalE2EAuth } from "@/lib/e2e-auth-guard";

interface PendingCookie {
  name: string;
  value: string;
  options: CookieOptions;
}

type LocalE2EIdentity = "administrator" | "ordinary";

function requestedIdentity(request: NextRequest): LocalE2EIdentity | null {
  const value = request.headers.get("x-tcg-e2e-identity") ?? "administrator";
  if (value === "administrator" || value === "ordinary") return value;
  return null;
}

export async function POST(request: NextRequest) {
  if (!allowLocalE2EAuth({
    enabled: process.env.E2E_AUTH_ENABLED,
    nodeEnvironment: process.env.NODE_ENV,
    configuredSecret: process.env.E2E_AUTH_SECRET,
    presentedSecret: request.headers.get("x-tcg-e2e-secret"),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  })) {
    return new NextResponse(null, { status: 404 });
  }

  const identity = requestedIdentity(request);
  if (!identity) {
    return NextResponse.json(
      { error: "unknown local E2E identity" },
      { status: 400 },
    );
  }

  const email = identity === "ordinary"
    ? process.env.E2E_AUTH_ORDINARY_EMAIL
    : process.env.E2E_AUTH_EMAIL;
  const password = identity === "ordinary"
    ? process.env.E2E_AUTH_ORDINARY_PASSWORD
    : process.env.E2E_AUTH_PASSWORD;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!email || !password || !supabaseUrl || !anonKey) {
    return NextResponse.json(
      { error: "local E2E auth is not fully configured" },
      { status: 503 },
    );
  }

  let pendingCookies: PendingCookie[] = [];
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: PendingCookie[]) {
        pendingCookies = cookiesToSet;
      },
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json(
      { error: "local GoTrue sign-in failed" },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ authenticated: true });
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options);
  }
  return response;
}
