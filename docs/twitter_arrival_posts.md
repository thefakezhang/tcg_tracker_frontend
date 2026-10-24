# Pokemon Twitter arrivals (Arrivals tab)

## Purpose

The Arrivals tab lets an administrator see the Pokemon arrival (stock photo) posts that reviewed shops put on X (Twitter), without opening each timeline.
Each card is post-level only: the X handle, the curated shop label when one exists, post time, the original images, and a link to the post.
Every card is explicitly unverified; the tab never presents availability, item identity, grade, condition, or price as known.

The tab is organized by account.
With 58 enrolled shops, one interleaved feed hid which accounts had posted today and how active each one is, and a filtered view could not be linked.
So the account is the primary axis: a panel lists every account with its activity, a selection narrows the feed server-side and lands in the URL, and the All view groups posts under their account.

Arrival posts are also time-sensitive: a stock photo from four days ago is almost never stock today.
Nothing is deleted, because the posts are evidence, but the tab shows a time window (48 hours by default) so old posts leave the feed instead of scrolling down forever.

## Goals

- One place to scan new arrivals from the enrolled shops, newest first, organized by the account that posted them.
- Show only what is still likely to matter: a window of 24 hours, 48 hours (the default), 7 days, or All, remembered per viewer and linkable.
- Show each account's activity (posts in the selected window and in total) so the operator sees at a glance who is posting.
- Make one shop's arrivals linkable: `/dashboard?view=arrivals&shop=<buyer_handle>&since=<window>` restores the selection and the window.
- Make the collection cadence explicit: the backend checks the shops hourly during shop hours, 11:00-20:00 JST.
- Keep the source one click away, so the operator judges the post itself.
- Keep working before the backend account summary is applied, by deriving the account list from the posts already loaded.

## Non-goals

- No recognition of the items in a photo and no arbitrage decision.
- No alerts, schedules, or per-account configuration from the frontend.
- No account statistics beyond what the summary RPC returns; the frontend never counts posts across pages it has not loaded, and says so when it is counting loaded posts.
- No deletion or archiving of arrival posts; All still shows every captured post.
- No server-side window on the posts RPC yet; the feed applies the window to the newest-first pages it receives (see Time window), and a `p_since` on `twitter_arrival_posts` is a possible backend follow-up.

## Architecture

The dashboard view `ArrivalPostsView` (slug `arrivals`, sidebar group Catalog) loads two private no-store endpoints.

- `/api/twitter-arrivals` returns the posts: the caller's session goes to backend RPC `twitter_arrival_posts` (migration 000580) with the optional `buyer_handle` filter and the composite cursor.
- `/api/twitter-arrivals/sources` returns the account summary: the caller's session goes to backend RPC `twitter_arrival_sources(p_since timestamptz default null)`, one row per account with `buyer_handle`, `twitter_handle`, `post_count`, `recent_count` (posts since `p_since`, default the last 24 hours) and `latest_post_at`.
  The route accepts an optional `since` timestamp for `p_since`; the view sends the window's cutoff, and All omits it so the backend default applies.

Both routes require the Supabase user session, never read tables directly, never use a service key, and map the backend administrator refusal to 403.
Backend contract and collection details: `docs/twitter_arrival_posts.md` in the backend repo.

### Account identity

Most enrolled shops have no entry in `lib/source-labels.ts`, so `@twitter_handle` is the primary identity everywhere (panel, group headers, cards) and the curated label is a secondary line shown only when one exists (`accountLabel` in `app/dashboard/arrival-accounts.ts`).

### Account panel

The panel is the left column on desktop (sticky) and a collapsible block above the feed on a phone, behind an `aria-expanded` toggle that closes again once an account is chosen.
It lists All accounts first, then every account sorted by `latest_post_at` descending, each as an `aria-pressed` button showing the handle, the label when known, posts in the selected window (labelled with it, "3 in 48 h") and posts in total, with a client-side search over handle, shop id and label.

While the sources RPC is not applied, PostgREST answers `PGRST202` (or Postgres `42883`); the route reports that as 501 with `reason: "rpc-missing"`, and the view derives the same rows from every post it has loaded this session (`deriveArrivalSources`), says so under the list, and keeps working.
Any other panel failure stays non-fatal: the posts feed renders and the panel shows its own small alert with Retry, unless the feed already failed the same way.

### Selection and URL state

The selected shop is a leaf query param, `?shop=<buyer_handle>`, owned by the view through `app/dashboard/url-params.ts` (`replaceState`, no history entry), exactly like a trip's `?tab=`.
`app/dashboard/url-state.ts` reads it only when `view=arrivals` and validates it against the same bound the API route puts on `buyer_handle` (1-100 visible characters); `UrlStateSync` carries it (and `?since=`) across a game switch and drops both when the view changes.
Selecting an account requests `buyer_handle=<shop>` server-side and resets the cursor; the view re-reads both params on `popstate`.

### Time window

A chip group in the feed header offers 24 h, 48 h, 7 days and All; 48 h is the default.
The choice is a leaf query param like the shop, `?since=24h|48h|7d|all` (`ARRIVALS_WINDOW_PARAM` and `parseWindowParam` in `url-params.ts`); the view keeps the default out of the URL and remembers the viewer's choice in localStorage (`arrivals.window`, through `lib/local-storage.ts`).
A link that names a window wins over the remembered choice without overwriting it.

The posts RPC has no since filter, but it returns rows newest first by observed time (`tweet_created_at`, else `acquired_at`), so the window is exact when applied client-side (`app/dashboard/arrival-window.ts`): rows observed before the cutoff are dropped, and once a page's last row is older than the cutoff every later page would be too, so Load more disappears.
The cutoff is measured from the moment the feed loaded, so appended pages and the account counts agree on it; Refresh moves it to now.
In the grouped All view an account with nothing in the window has no section; the panel still lists it with its total.
When the window hides every loaded post, the empty state names the window ("No arrival posts in the last 48 hours") and offers Show all, which switches to All; when there are no posts at all, the plain empty state shows.

The same cutoff goes to the sources route as `since`, so each account's recent count is the window's and is labelled with it ("in 48 h"); All omits it, and the label reads "in 24 h", the backend default.
The derived fallback counts against the same cutoff.

### Re-posts

Shops re-surface an arrival post by retweeting it, and that means the stock is still there.
The backend adds optional fields to the `twitter_arrival_posts` rows for this: `last_boosted_at` (when the post was last re-surfaced, or null), `boost_count` (how many times, default 0) and `via_retweet_of` (the X handle the post was retweeted from, or null), and orders rows by the later of the tweet time and the last boost.
The frontend treats the fields as optional (absent means never re-posted, and the tab behaves exactly as before) and applies one time rule everywhere (`lib/arrival-observed-at.ts`): a row's observed time is the later of its tweet time (else collection time) and `last_boosted_at`.
That rule drives the window, the stop-paging rule, group order, the derived counts, and the posts route's cursor, which carries the same value as `before` so paging follows the backend order.
A re-posted card shows a "Re-posted 3 hours ago" badge (`Intl.RelativeTimeFormat`, `lib/relative-time.ts`; "Re-posted 3 times, last 3 hours ago" when the count is more than one; the absolute JST time is in its tooltip) and, when the post reached the shop through a retweet, "via @handle".

### Grouping

In the All view a Group by account toggle (default on) renders one collapsible section per account, ordered by that account's newest loaded post, each with the same cards newest first; Load more appends into the groups.
Off, the feed is the flat newest-first grid.
The toggle (`arrivals.groupByAccount`) and the collapsed accounts (`arrivals.collapsedAccounts`, a JSON array of `buyer_handle`) persist per viewer in localStorage through `lib/local-storage.ts`, whose reads and writes are wrapped in try/catch so a blocked storage API only loses the preference.

## Operator journey

Open Arrivals from the dashboard navigation.
The feed shows the last 48 hours; pick 24 h, 7 days or All in the header to narrow or widen it, and the choice is remembered.
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
It accepts the optional re-post fields when they are well formed (a parseable or null `last_boosted_at`, a non-negative integer `boost_count`, a non-empty or null `via_retweet_of`) and rejects a malformed one; the posts route likewise fails closed on an unreadable `last_boosted_at` in a cursor row.
The sources parser requires both handles, non-negative integer counts and a parseable or null timestamp.

`app/api/twitter-arrivals/route.test.ts`, `app/api/twitter-arrivals/sources/route.test.ts`, `app/dashboard/arrival-accounts.test.ts`, `app/dashboard/arrival-window.test.ts`, `app/dashboard/url-state.test.ts` and `app/dashboard/ArrivalPostsView.test.tsx` cover these boundaries and the loading, empty, retry, expired-session, forbidden, pagination, deduplication, account list, derived fallback, URL selection, grouping and time-window states (cutoff filtering, the stop-paging rule, the window's empty state with Show all, URL and localStorage round trips).
