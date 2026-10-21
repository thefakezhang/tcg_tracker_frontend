# Pokemon Twitter arrivals (Arrivals tab)

## Purpose

The Arrivals tab lets an administrator see the Pokemon arrival (stock photo) posts that reviewed shops put on Twitter, without opening each timeline.
Each card is post-level only: shop, Twitter handle, post time, the original images, and a link to the post.
Every card is explicitly unverified; the tab never presents availability, item identity, grade, condition, or price as known.

## Goals

- One place to scan new arrivals from the enrolled shops, newest first.
- Make the collection cadence explicit: the backend checks the shops hourly during shop hours, 11:00-20:00 JST.
- Keep the source one click away, so the operator judges the post itself.

## Non-goals

- No recognition of the items in a photo and no arbitrage decision.
- No alerts, schedules, or source configuration from the frontend.

## Architecture

The dashboard view `ArrivalPostsView` (slug `arrivals`, sidebar group Catalog) loads `/api/twitter-arrivals` with a private no-store request.
The route requires the Supabase user session and calls the backend RPC `twitter_arrival_posts` with that caller session; it never reads tables directly and never uses a service key.
The RPC performs the administrator check and returns a bounded projection.
Backend migration `000580_twitter_arrival_posts` is the runtime prerequisite; until it is applied the tab shows its designed unavailable state.
Backend contract and collection details: `docs/twitter_arrival_posts.md` in the backend repo.

Shop names render through `sourceLabel` (`lib/source-labels.ts`); the filter takes the exact shop id (for example `alice`).

## Operator journey

Open Arrivals from the dashboard navigation.
The default request returns up to 100 newest posts; Load more posts appends the next composite-cursor page.
If a later request fails, the loaded posts and cursor remain visible.
An expired session offers a sign-in link in a new tab and a Continue after signing in action that retries the same cursor.
An administrator refusal explains the required role without a transient Retry action.
Enter an exact shop id and select Show posts to narrow the list; a new filter resets the cursor.
Open an image to see the original media, or Open original post for the full context.

Source-post time and evidence-collection time are labeled separately in Japan Standard Time.
Media use `object-fit: contain` inside bounded previews, through the authenticated image proxy.

## Input and response boundaries

The API route accepts an optional shop id up to 100 visible characters, a page limit from 1 through 100, and an optional composite cursor whose timestamp and key must be supplied together; malformed input returns 400 before the RPC call.
It returns 401 without a session, maps the backend administrator refusal to 403, and sends `Cache-Control: private, no-store`.
The browser parser requires post identity, source identity, timestamps, source URLs, at least one media item, SHA-256 digests, and `unverified: true`, and rejects the response if item identity, JPY price, price side, grade, or condition appears.

`app/api/twitter-arrivals/route.test.ts` and `app/dashboard/ArrivalPostsView.test.tsx` cover these boundaries and the loading, empty, retry, expired-session, forbidden, pagination, deduplication, and filter states.
