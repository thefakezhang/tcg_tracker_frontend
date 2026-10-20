# Pokemon Twitter arrival posts

## Purpose

The Arrival posts dashboard view lets an administrator inspect newly stocked Pokemon posts from reviewed shops without presenting item identity, grade, condition, or price as known facts.
Each card is explicitly marked unverified and links to the original post and each acquired source image.

## Architecture

The dashboard loads `/api/twitter-arrivals` with a private no-store request.
The route requires the existing Supabase user session and calls the backend `twitter_arrival_posts` RPC with that caller session.
It never reads arrival tables directly and never uses a service key.
The RPC performs the administrator authorization check and returns a bounded sanitized projection.

The backend migration `000575_twitter_arrival_hourly_digest` is a runtime prerequisite for this frontend.
Deploying the frontend before that migration and RPC are available produces the designed unavailable state rather than exposing a fallback data path.

## Operator journey

Open Arrival posts from the dashboard navigation.
The default request returns up to 100 newest eligible posts.
Enter an exact canonical buyer handle in Shop account and select Show posts to narrow the list.
Open an image to inspect the original media URL or select Open original post to inspect the complete source context.

The view shows the canonical buyer, Twitter handle, Tokyo post time, unverified status, and every ordered media item.
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

Component tests cover loading, empty, error, retry, filter submission, source links, ordered media, unverified labeling, forbidden fields, and complete-image fitting.
The controlled browser journey covers loaded, empty, error, and unauthorized states at desktop and 390-pixel widths, keyboard navigation, mobile tap targets, horizontal overflow, landscape and portrait previews, and zero external requests.

## Non-goals and rollout state

The view does not recognize items in a photograph and does not calculate an arbitrage decision.
It does not configure a source, schedule, alert recipient, or webhook.
It does not imply hourly acquisition freshness because source collection has its own disabled rollout gate.
The backend and frontend remain staged until migration, hosted authentication, collection cadence, and live operator acceptance are completed.
