# Pokemon Twitter arrivals (Arrivals tab)

## Purpose

The Arrivals tab lets an administrator see the Pokemon arrival (stock photo) posts that reviewed shops put on X (Twitter), without opening each timeline.
Each card is post-level only: the X handle, the curated shop label when one exists, post time, the original images, and a link to the post.
Every card is explicitly unverified; the tab never presents availability, item identity, grade, condition, or price as known.

The tab is organized by account.
With 58 enrolled shops, one interleaved feed hid which accounts had posted today and how active each one is, and a filtered view could not be linked.
So the account is the primary axis: a panel lists every account with its activity, a selection narrows the feed server-side and lands in the URL, and the All view groups posts under their account.

## Goals

- One place to scan new arrivals from the enrolled shops, newest first, organized by the account that posted them.
- Show each account's activity (posts in the last 24 hours and in total) so the operator sees at a glance who is posting.
- Make one shop's arrivals linkable: `/dashboard?view=arrivals&shop=<buyer_handle>` restores the selection.
- Make the collection cadence explicit: the backend checks the shops hourly during shop hours, 11:00-20:00 JST.
- Keep the source one click away, so the operator judges the post itself.
- Keep working before the backend account summary is applied, by deriving the account list from the posts already loaded.

## Non-goals

- No recognition of the items in a photo and no arbitrage decision.
- No alerts, schedules, or per-account configuration from the frontend.
- No account statistics beyond what the summary RPC returns; the frontend never counts posts across pages it has not loaded, and says so when it is counting loaded posts.

## Architecture

The dashboard view `ArrivalPostsView` (slug `arrivals`, sidebar group Catalog) loads two private no-store endpoints.

- `/api/twitter-arrivals` returns the posts: the caller's session goes to backend RPC `twitter_arrival_posts` (migration 000580) with the optional `buyer_handle` filter and the composite cursor.
- `/api/twitter-arrivals/sources` returns the account summary: the caller's session goes to backend RPC `twitter_arrival_sources(p_since timestamptz default null)`, one row per account with `buyer_handle`, `twitter_handle`, `post_count`, `recent_count` (last 24 hours) and `latest_post_at`.
  The route accepts an optional `since` timestamp for `p_since` and otherwise leaves the backend default in place.

Both routes require the Supabase user session, never read tables directly, never use a service key, and map the backend administrator refusal to 403.
Backend contract and collection details: `docs/twitter_arrival_posts.md` in the backend repo.

### Account identity

Most enrolled shops have no entry in `lib/source-labels.ts`, so `@twitter_handle` is the primary identity everywhere (panel, group headers, cards) and the curated label is a secondary line shown only when one exists (`accountLabel` in `app/dashboard/arrival-accounts.ts`).

### Account panel

The panel is the left column on desktop (sticky) and a collapsible block above the feed on a phone, behind an `aria-expanded` toggle that closes again once an account is chosen.
It lists All accounts first, then every account sorted by `latest_post_at` descending, each as an `aria-pressed` button showing the handle, the label when known, posts in the last 24 hours and posts in total, with a client-side search over handle, shop id and label.

While the sources RPC is not applied, PostgREST answers `PGRST202` (or Postgres `42883`); the route reports that as 501 with `reason: "rpc-missing"`, and the view derives the same rows from every post it has loaded this session (`deriveArrivalSources`), says so under the list, and keeps working.
Any other panel failure stays non-fatal: the posts feed renders and the panel shows its own small alert with Retry, unless the feed already failed the same way.

### Selection and URL state

The selected shop is a leaf query param, `?shop=<buyer_handle>`, owned by the view through `app/dashboard/url-params.ts` (`replaceState`, no history entry), exactly like a trip's `?tab=`.
`app/dashboard/url-state.ts` reads it only when `view=arrivals` and validates it against the same bound the API route puts on `buyer_handle` (1-100 visible characters); `UrlStateSync` carries it across a game switch and drops it when the view changes.
Selecting an account requests `buyer_handle=<shop>` server-side and resets the cursor; the view re-reads the param on `popstate`.

### Grouping

In the All view a Group by account toggle (default on) renders one collapsible section per account, ordered by that account's newest loaded post, each with the same cards newest first; Load more appends into the groups.
Off, the feed is the flat newest-first grid.
The toggle (`arrivals.groupByAccount`) and the collapsed accounts (`arrivals.collapsedAccounts`, a JSON array of `buyer_handle`) persist per viewer in localStorage through `lib/local-storage.ts`, whose reads and writes are wrapped in try/catch so a blocked storage API only loses the preference.

## Operator journey

Open Arrivals from the dashboard navigation.
The All view loads up to 100 newest posts grouped by account; collapse an account to skip it, or turn Group by account off for one flat list.
Select an account in the panel to see only its posts; the URL updates so the view can be shared or bookmarked, and Show all accounts returns to the full feed.
Load more posts appends the next composite-cursor page.
If a later request fails, the loaded posts and cursor remain visible.
An expired session offers a sign-in link in a new tab and a Continue after signing in action that retries the same cursor.
An administrator refusal explains the required role without a transient Retry action.
Open an image to see the original media, or Open original post for the full context.

Source-post time and evidence-collection time are labeled separately in Japan Standard Time.
Media use `object-fit: contain` inside bounded previews, through the authenticated image proxy.

## Input and response boundaries

The posts route accepts an optional shop id up to 100 visible characters, a page limit from 1 through 100, and an optional composite cursor whose timestamp and key must be supplied together; malformed input returns 400 before the RPC call.
The sources route accepts an optional `since` RFC 3339 timestamp and returns 501 with `reason: "rpc-missing"` while the RPC is absent.
Both return 401 without a session, map the backend administrator refusal to 403, and send `Cache-Control: private, no-store` on success.
The browser parser requires post identity, source identity, timestamps, source URLs, at least one media item, SHA-256 digests, and `unverified: true`, and rejects the response if item identity, JPY price, price side, grade, or condition appears.
The sources parser requires both handles, non-negative integer counts and a parseable or null timestamp.

`app/api/twitter-arrivals/route.test.ts`, `app/api/twitter-arrivals/sources/route.test.ts`, `app/dashboard/arrival-accounts.test.ts`, `app/dashboard/url-state.test.ts` and `app/dashboard/ArrivalPostsView.test.tsx` cover these boundaries and the loading, empty, retry, expired-session, forbidden, pagination, deduplication, account list, derived fallback, URL selection and grouping states.
