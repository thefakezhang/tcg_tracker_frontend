# Pokemon Twitter arrival posts

## Purpose

The Arrival posts dashboard view lets an administrator inspect captured Pokemon arrival posts from reviewed shops without presenting current availability, item identity, grade, condition, or price as known facts.
Each card is explicitly marked unverified and links to the original post and each acquired source image.

## Architecture

The dashboard loads `/api/twitter-arrivals` with a private no-store request.
The route requires the existing Supabase user session and calls the backend `twitter_arrival_posts` RPC with that caller session.
It never reads arrival tables directly and never uses a service key.
The RPC performs the administrator authorization check and returns a bounded sanitized projection.

The backend migration `000576_twitter_arrival_hourly_digest` is a runtime prerequisite for this frontend.
Deploying the frontend before that migration and RPC are available produces the designed unavailable state rather than exposing a fallback data path.

## Operator journey

Open Arrival posts from the dashboard navigation.
The default request returns up to 100 newest eligible posts.
Select Load more posts to append the next composite-cursor page without replacing posts already shown.
If a later request fails, the loaded posts and cursor remain visible.
An expired session provides a sign-in link that opens in a new tab and a Continue after signing in action that retries the same cursor.
An administrator refusal explains the required role and offers an administrator sign-in path without presenting a transient Retry action.
Enter an exact canonical buyer handle in Shop account and select Show posts to narrow the list.
Submitting a new filter resets the cursor and replaces the prior result set.
Open an image to inspect the original media URL or select Open original post to inspect the complete source context.

The view labels the source-post time and evidence-collection time separately in Japan Standard Time, alongside the canonical buyer, Twitter handle, unverified status, and every ordered media item.
Neither timestamp claims that the post is fresh or that the pictured stock remains available.
Landscape and portrait media use `object-fit: contain` inside bounded previews so edges and labels remain visible.
Loading, empty, error, retry, forbidden, and unauthorized outcomes remain explicit.

## Input and response boundaries

The API route accepts an optional buyer handle up to 100 visible characters, a page limit from 1 through 100, and an optional composite cursor.
The cursor timestamp and stable post key must be supplied together.
Malformed filters, timestamps, keys, and limits return 400 before the RPC call.

The browser parser requires stable post identity, source identity, timestamps, source URLs, at least one media item, canonical SHA-256 values, and `unverified: true`.
It fails the response if item identity, JPY price, price side, grade, or condition appears.
This prevents a backend contract expansion from silently turning post-level evidence into an item recommendation.

## Security and evidence

The route returns 401 without a valid session and maps the backend administrator refusal to 403.
Successful responses use `Cache-Control: private, no-store`.
Image previews use the existing authenticated image proxy, while the evidence links retain the original media URL.

Component tests cover loading, empty, transient retry, visible expired-session recovery with same-cursor retention, permanent administrator refusal, 100-row tied-timestamp pagination, stable-key deduplication, filter reset, source links, labeled source and collection times, ordered media, unverified labeling, forbidden fields, and complete-image fitting.
The isolated browser journey crosses real GoTrue password sessions, PostgREST, PostgreSQL, the protected Next API, and the production dashboard.
It covers no-session 401, actionable ordinary-user 403 guidance, administrator pages of 100 and 6 unique database rows, visible sign-in recovery from an expired session without losing loaded rows or the cursor, filter and empty states, desktop and 390-pixel widths, mobile tap targets, horizontal overflow, landscape and portrait previews, and zero external requests.

## Non-goals and rollout state

The view does not recognize items in a photograph and does not calculate an arbitrage decision.
It does not configure a source, schedule, alert recipient, or webhook.
It does not imply hourly acquisition freshness because source collection has its own disabled rollout gate.
The backend and frontend remain staged until migration, hosted authentication, collection cadence, and live operator acceptance are completed.
