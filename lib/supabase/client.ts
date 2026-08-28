import { createBrowserClient } from "@supabase/ssr";

// Hard ceiling on any single request. WITHOUT this, a hung connection (flaky
// wifi, laptop sleep/wake, network switch — TCP open but no response, which
// never throws) waits forever. The worst case is a hung *auth token refresh*:
// it's serialized behind GoTrue's Web Lock, so while it hangs every
// authenticated query blocks on the lock and the whole app freezes with "no
// data". A timeout turns the hang into an abort → the lock releases and the app
// recovers (reads retry below; the next request triggers a fresh refresh).
const REQUEST_TIMEOUT_MS = 15_000;

// Retry transient network failures for safe (GET) requests so reads self-heal
// instead of surfacing "NetworkError when attempting to fetch resource".
// Mutations (POST/PATCH/DELETE/RPC) are NOT retried here — re-sending could
// double-apply (e.g. a duplicate sale); callers retry those explicitly when safe.
async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const tries = method === "GET" ? 3 : 1;
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new DOMException("request timeout", "TimeoutError")), REQUEST_TIMEOUT_MS);
    // Honor a caller-supplied signal (e.g. supabase's own .abortSignal()) too.
    const caller = init?.signal;
    if (caller) {
      if (caller.aborted) ctrl.abort(caller.reason);
      else caller.addEventListener("abort", () => ctrl.abort(caller.reason), { once: true });
    }
    try {
      return await fetch(input, { ...init, signal: ctrl.signal });
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// GoTrue serialises auth work behind a cross-tab Web Lock. For the paths it
// does not want to queue it calls the lock with acquireTimeout === 0, which
// makes the default navigatorLock use `ifAvailable: true` and THROW the moment
// anything else holds the lock:
//
//   Error: Acquiring an exclusive Navigator LockManager lock
//     "lock:sb-<ref>-auth-token" immediately failed
//
// A second tab, or a refresh still in flight, is enough. The rejection is
// unhandled, the token refresh never happens, and every authenticated query
// then hangs until the fetch timeout above aborts it - which the browser
// reports as "CORS request did not succeed / Status code: (null)". The symptom
// is a dashboard that renders but returns no data, and searches that silently
// come back empty.
//
// Waiting briefly is strictly better than failing: the holder is a token
// refresh that finishes in milliseconds. Bounded, so a genuinely stuck holder
// still surfaces instead of hanging forever.
const AUTH_LOCK_WAIT_MS = 10_000;

export async function waitingNavigatorLock<R>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> {
  const locks = globalThis.navigator?.locks;
  // Non-secure contexts and older browsers have no LockManager. GoTrue's own
  // fallback is to run unlocked, so match it rather than breaking auth.
  if (typeof locks?.request !== "function") return fn();

  const waitMs = acquireTimeout === 0 ? AUTH_LOCK_WAIT_MS : acquireTimeout;
  const controller = new AbortController();
  const timer = waitMs > 0 ? setTimeout(() => controller.abort(), waitMs) : undefined;
  try {
    return (await locks.request(
      name,
      waitMs > 0 ? { mode: "exclusive", signal: controller.signal } : { mode: "exclusive" },
      async () => fn(),
    )) as R;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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
      {
        global: { fetch: fetchWithRetry },
        auth: { lock: waitingNavigatorLock },
      }
    );
  }
  return client;
}
