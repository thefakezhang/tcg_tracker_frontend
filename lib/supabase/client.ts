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

// GoTrue guards auth work with a cross-tab Web Lock, and auth-js recovers from
// a lock it believes is orphaned by STEALING it (lib/locks.js). A steal is not
// polite: per the Web Locks spec it breaks every other holder, whose pending
// operations reject with
//
//   AbortError: Lock broken by another request with the 'steal' option.
//   AbortError: The lock request is aborted                (Firefox's wording)
//
// It steals after `lockAcquireTimeout`, which is 5s and CANNOT be configured
// through supabase-js: SupabaseClient#_initSupabaseAuthClient destructures an
// explicit allowlist of auth options and `lockAcquireTimeout` is not in it, so
// passing it is silently dropped. `lock` IS forwarded, so replacing the lock is
// the only way to control this.
//
// That 5s ceiling collides with fetchWithRetry above, which lets a single call
// hold the lock for far longer. Any token refresh slower than 5s therefore
// GUARANTEES a steal, and the steal kills every query queued behind it. One
// slow refresh is enough to empty a dashboard: measured with two dashboards
// each issuing 10 reads over an 8s refresh, the stock lock served 1 of 20 reads
// and raised 4 unhandled rejections; this lock serves 20 of 20 with none.
//
// More tabs make it worse, not better - every open dashboard adds queued
// operations for the steal to break - which is why this surfaces for anyone
// who keeps several dashboards open.
//
// Worst case a single call can hold the lock: fetchWithRetry's GET path is
// three attempts plus its 250ms + 500ms backoff.
export const MAX_LOCK_HOLD_MS = REQUEST_TIMEOUT_MS * 3 + 750;

// Wait at least this long before concluding a lock is orphaned. It MUST exceed
// MAX_LOCK_HOLD_MS, otherwise we reintroduce the storm we are fixing: a holder
// that is merely slow gets mistaken for a dead one and broken mid-flight.
// Asserted by a test so the two constants cannot drift apart.
export const AUTH_LOCK_MIN_WAIT_MS = 60_000;

/**
 * The auth lock, replacing auth-js's navigatorLock.
 *
 * Two behaviours differ from the default, deliberately:
 *  - a slow holder is waited out rather than stolen from at 5s;
 *  - `acquireTimeout === 0` keeps its skip semantics (see below).
 */
export async function resilientAuthLock<R>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> {
  const locks = globalThis.navigator?.locks;
  // Non-secure contexts and older browsers have no LockManager. GoTrue's own
  // fallback is to run unlocked, so match it rather than breaking auth.
  if (typeof locks?.request !== "function") return fn();

  // acquireTimeout === 0 is the auto-refresh tick asking "is another tab
  // already doing auth work?". Skipping is the CORRECT answer and the reason
  // auth-js passes 0: the other tab's refresh lands in the shared cookie the
  // whole browser reads, so this tick has nothing left to do. Queueing here
  // instead performs a redundant second refresh and slows every query behind
  // it.
  if (acquireTimeout === 0) {
    return (await locks.request(
      name,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        // Contended: another tab is already doing auth work, and its refresh
        // lands in the cookie this whole browser shares, so this tick has
        // nothing left to do. Resolve quietly.
        //
        // Do NOT throw a marker error here. auth-js's own lock does, and
        // relies on _autoRefreshTokenTick recognising it by `isAcquireTimeout`
        // or `instanceof LockAcquireTimeoutError`. That recognition is
        // version-dependent, and when it misses, nothing catches the rejection
        // and every contended tick prints
        //   Uncaught (in promise) Error: Acquiring an exclusive Navigator
        //   LockManager lock "lock:sb-<ref>-auth-token" immediately failed
        // in the operator's console. Skipping silently is the same outcome
        // without depending on a catch we do not control. The tick's return
        // value is unused, and the next tick retries in 30s.
        if (!lock) return undefined as R;
        return fn();
      },
    )) as R;
  }

  const controller = new AbortController();
  const waitMs = Math.max(acquireTimeout, AUTH_LOCK_MIN_WAIT_MS);
  const timer = setTimeout(() => controller.abort(), waitMs);
  try {
    return (await locks.request(
      name,
      { mode: "exclusive", signal: controller.signal },
      async () => fn(),
    )) as R;
  } catch (e) {
    if ((e as Error | null)?.name !== "AbortError") throw e;
    // Only now, after longer than any request of ours can hold the lock, is a
    // holder genuinely stuck (a tab killed mid-refresh leaves no releaser).
    // Steal exactly as auth-js would - the recovery is right, its 5s trigger
    // was not.
    return (await locks.request(
      name,
      { mode: "exclusive", steal: true },
      async () => fn(),
    )) as R;
  } finally {
    clearTimeout(timer);
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
        auth: { lock: resilientAuthLock },
      }
    );
  }
  return client;
}
