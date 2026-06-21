import { createBrowserClient } from "@supabase/ssr";

// Single shared browser client. createClient() is called from dozens of places;
// returning a NEW client each time spins up multiple GoTrue auth instances that
// race to refresh the (single-use) token, invalidating it and causing
// "NetworkError when attempting to fetch resource" until a hard refresh. Memoize
// so the whole app shares one client (the recommended browser pattern).
let client: ReturnType<typeof createBrowserClient> | undefined;

export function createClient() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return client;
}
