# Supabase browser client

How `lib/supabase/client.ts` is built, and why it does not use the stock defaults.

## Architecture

Every client component reaches Supabase through `createClient()` in `lib/supabase/client.ts`.
48 modules import it, and it memoizes a single `createBrowserClient` instance for the whole tab.
That memo is load-bearing: a fresh client per call would create several GoTrue instances under one storage key, each running its own auto-refresh, racing to spend the same single-use refresh token.

Two behaviours are overridden.

**`global.fetch` is `fetchWithRetry`.**
It caps every request at `REQUEST_TIMEOUT_MS` (15s) and retries GETs three times, so a connection that is open but silent (sleep/wake, network switch) fails instead of hanging forever.

**`auth.lock` is `resilientAuthLock`.**
It replaces auth-js's `navigatorLock`, for the reason below.

## Why the auth lock is replaced

GoTrue serialises auth work behind a per-origin Web Lock so that tabs cannot spend the same single-use refresh token twice.
When a lock acquisition waits longer than `lockAcquireTimeout`, auth-js concludes the holder is orphaned and **steals** the lock.
A steal is not polite: per the Web Locks spec it breaks every other holder, whose pending work rejects with `AbortError: Lock broken by another request with the 'steal' option.` (Firefox words it `AbortError: The lock request is aborted`).

`lockAcquireTimeout` defaults to 5s and cannot be configured through supabase-js.
`SupabaseClient#_initSupabaseAuthClient` destructures an explicit allowlist of auth options (`autoRefreshToken`, `persistSession`, `detectSessionInUrl`, `storage`, `userStorage`, `storageKey`, `flowType`, `lock`, `debug`, `throwOnError`) and silently drops anything else, `lockAcquireTimeout` included.
`lock` is forwarded, so supplying our own lock is the only way to control the steal.

That 5s ceiling collides with `fetchWithRetry`, which lets one call hold the lock for much longer.
Any token refresh slower than 5s therefore guarantees a steal, and the steal kills every query queued behind it.
The user-visible symptom is a dashboard that renders but shows no data, and a search box that returns nothing, because the queries were aborted rather than answered.

More open tabs make this worse, not better.
Each tab contributes queued operations for the steal to break, so the failure grows with the number of dashboards the operator keeps open.

## Behaviour

`resilientAuthLock` differs from the default in exactly two ways.

**A slow holder is waited out, not stolen from.**
The acquire wait is raised to `AUTH_LOCK_MIN_WAIT_MS` (60s), which must exceed `MAX_LOCK_HOLD_MS`, the longest `fetchWithRetry` can legitimately hold the lock (three attempts plus backoff, 45.75s).
A test asserts that relationship so the two constants cannot drift apart and quietly reintroduce the bug.
Stealing still happens after that floor elapses, because a tab killed mid-refresh really does leave a lock nobody will release; only the trigger moved.

**`acquireTimeout === 0` keeps its skip semantics.**
auth-js passes 0 from exactly one place, `_autoRefreshTokenTick`, which is asking "is another tab already doing auth work?".
Skipping is the correct answer: the other tab's refresh lands in the cookie the whole browser shares, so this tick has nothing left to do, and `_autoRefreshTokenTick` catches the skip by the documented `isAcquireTimeout` property.
Queueing instead performs a redundant refresh per tab and slows every query behind it.

## Evidence

Reproduced in a real browser (Chromium and Firefox), driving tabs against a fake GoTrue that enforces genuine single-use refresh-token rotation, with an 8s refresh and Supabase's real 1-hour access token.

| tabs | stock reads served | with this lock | stock refreshes | with this lock |
|---|---|---|---|---|
| 2 | 1/20 | 20/20 | 2 | 1 |
| 4 | 1/40 | 40/40 | 4 | 1 |
| 6 | 1/60 | 60/60 | 6 | 1 |
| 8 | 1/80 | 80/80 | 8 | 1 |

Stock also raised 4 to 22 unhandled promise rejections across that range; this lock raises none.
Where the refresh is fast (400ms) the two are indistinguishable (~415ms wall, 20/20 reads), so the change costs nothing in the normal case.
Two separate browsers with three tabs each serve 60/60 with no token-reuse rejections, as expected: separate browsers have separate cookie jars and separate LockManagers, so they hold independent sessions and never contend.

## Goals

- Keep multiple dashboards open in one browser without queries being aborted.
- Preserve auth-js's recovery from a genuinely orphaned lock.
- Keep exactly one token refresh per browser regardless of tab count.
- Fail loudly rather than hang: every request and every lock acquisition stays bounded.

## Non-goals

- Coordinating auth across different browsers or profiles. They hold separate sessions; there is nothing to coordinate.
- Coordinating with the server-side refresh in `lib/supabase/middleware.ts`. A browser Web Lock cannot reach it. GoTrue's refresh-token reuse interval covers that overlap, and concurrent middleware invocations were measured resolving through the grace path rather than rejecting.
- Reducing how many queries a dashboard issues on mount. Fewer would ease contention, but the lock must be correct regardless.
