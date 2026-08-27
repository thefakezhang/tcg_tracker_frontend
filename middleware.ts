import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // /wantlist is a public, statically generated page with no auth context.
    // Running the session refresh on it would add a Supabase getUser() round
    // trip to every anonymous hit and defeat static delivery.
    "/((?!_next/static|_next/image|favicon.ico|wantlist|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
