import { createBrowserClient } from "@supabase/ssr";

// Retry transient network failures for safe (GET) requests so reads self-heal
// instead of surfacing "NetworkError when attempting to fetch resource".
// Mutations (POST/PATCH/DELETE/RPC) are NOT retried here — re-sending could
// double-apply (e.g. a duplicate sale); callers retry those explicitly when safe.
async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const tries = method === "GET" ? 3 : 1;
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(input, init);
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw lastErr;
}

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
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { fetch: fetchWithRetry } }
    );
  }
  return client;
}
