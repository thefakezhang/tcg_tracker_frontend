# Pokemon Twitter arrivals (Arrivals tab)

## Purpose

The Arrivals tab lets an administrator see the Pokemon arrival (stock photo) posts that reviewed shops put on X (Twitter), without opening each timeline.
Each card is post-level only: the X handle, the curated shop label when one exists, post time, the post's original caption when the backend has kept it, the original images, and a link to the post.
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
- Show every post an account made in the window, not only the ones that fell in the first page, and keep one prolific shop from pushing the other accounts off the page.
- Show the shop's own words: the post's original caption, as plain text.
- Make one shop's arrivals linkable: `/dashboard?view=arrivals&shop=<buyer_handle>&since=<window>` restores the selection and the window.
- Narrow the feed and the account list to any mix of regions (Tokyo neighbourhoods, Fukuoka, and any other region the run reads), linkable as `?region=<key>,<key>`, since the feed mixes cities once more than one region is in focus; selecting a region the run does not read hourly asks for a read once, and the feed fills in shop by shop while that read runs.
- Make the collection cadence explicit: the backend checks the regions in focus hourly during shop hours, 11:00-20:00 JST, and reads any other region when the operator selects it; the subtitle says both.
- Keep the source one click away, so the operator judges the post itself.
- Keep working before the backend account summary is applied, by deriving the account list from the posts already loaded.
- Let the operator choose which regions the hourly run reads (backend #2342): put a region in focus, in focus until a date for a trip, or out of it, and ask for any other region to be read once.

## Non-goals

- No recognition of the items in a photo and no arbitrage decision.
- No alerts, schedules, or per-account configuration from the frontend; the region focus is the one run setting the tab changes, and only through the backend's administrator RPCs.
- No account statistics beyond what the summary RPC returns and the posts loaded for the window; the frontend never counts posts across pages it has not loaded, and says so when it is counting loaded posts.
- No deletion or archiving of arrival posts; All still shows every captured post.
- No translation, parsing, or interpretation of the caption; it is shown as the shop wrote it, and only the `https://t.co/...` links X puts in it become links.

## Architecture

The dashboard view `ArrivalPostsView` (slug `arrivals`, sidebar group Catalog) loads two private no-store endpoints.

- `/api/twitter-arrivals` returns the posts: the caller's session goes to backend RPC `twitter_arrival_posts` (migration 000580, re-posts and `p_since` since 000603, `tweet_text` since 000605, the row's `region` since 000640, `p_regions` since 000641) with the optional `buyer_handle` filter, the composite cursor, the optional `since` window start for `p_since`, and the optional region keys for `p_regions`.
  The route takes `regions=a,b` (and the single `region=a` of older links) and sends them as one `p_regions` text array, only when a region is asked for, so every other request keeps working against a backend from before the region filter; it never sends `p_region`.
- `/api/twitter-arrivals/sources` returns the account summary: the caller's session goes to backend RPC `twitter_arrival_sources(p_since timestamptz default null)`, one row per account with `buyer_handle`, `twitter_handle`, `post_count`, `recent_count` (posts since `p_since`, default the last 24 hours), `latest_post_at` and, with the region filter, `region` (the account's region key, or null while the shop is not mapped).
  The route accepts an optional `since` timestamp for `p_since`; the view sends the window's cutoff, and All omits it so the backend default applies.

- `/api/twitter-arrivals/regions` is the region focus (backend #2342, migration 000622): GET passes the caller's session to `twitter_arrivals_focus_status()`, and POST takes one change, `{action: "set_focus", region, until}` (`until` a `YYYY-MM-DD` Tokyo date or null), `{action: "clear_focus", region}`, `{action: "reset_focus"}` or `{action: "request_read", region}`, calls `twitter_arrivals_set_focus`, `twitter_arrivals_clear_focus` (null region for the reset) or `twitter_arrivals_request_read`, and answers with the status after the change.

All three routes require the Supabase user session, never read tables directly, never use a service key, and map the backend administrator refusal to 403.
Backend contract and collection details: `docs/twitter_arrival_posts.md` and `docs/twitter_arrivals_region_lists.md` (focus regions) in the backend repo.

### Regions

The hourly backend run reads only the region X Lists of the focus, Tokyo and Kanto by default, and any other region once on request (backend #2342).
`ArrivalRegionPanel` sits above the feed: a header with the hourly focus in one line ("Read hourly: Akihabara, Ikebukuro, ... (default focus)", and how many read-once requests are pending) and a Show regions toggle (`aria-expanded`), closed by default so the posts stay first.
Open, it explains the cadence and lists every region the run has published, in roster order, two or three to a row on desktop and one on a phone, each with:

- its status: In focus (default), In focus (set by the operator), In focus until a date, or Not in focus;
- its shops, how many of its lists are readable, and when its lists were last read;
- a pending read-once request ("Reading now; requested 2 minutes ago", or "queued for the next run in shop hours, 11:00-20:00 JST" when the read job is not reading it and it is outside those hours; see Region filter for the rule), or when it was last read once;
- its controls: Add focus, Focus until (a Tokyo date from today to a year ahead, a week ahead by default) or Change date, Keep in focus for a dated region, Remove, and for a region out of focus Read once.

Read once is absent, not disabled, while the region has no readable list yet (the backend list rollout fills them), and says so; once asked, the button reads Read once pending and stays disabled until a run fulfils the request.
While the operator's focus is set, Return to default focus clears it.
Each change replaces the panel's state with the status the RPC returns; a refused change keeps the panel and shows the backend's reason on that region.
Every control is a 44 px target at every width (`min-h-11 sm:min-h-11`, overriding the Button's compact desktop height).
Region names are translated (`arrivals.regionName.<region>`); an unknown region key shows as itself.
While the RPCs are absent the route answers 501 with `reason: "rpc-missing"`, and the panel says the controls appear once the backend migration is applied and that the run reads the default focus until then; before the first run after the migration it says the run has not published its regions yet.
The data logic is `app/dashboard/arrival-regions.ts` (the status parser, the Tokyo date arithmetic, a region's read state, and the route client).
The tab loads the status once (`useArrivalRegionStatus` in `app/dashboard/use-arrival-region-status.ts`) and hands it to both the panel and the region filter, so a read asked for in either shows in both at once.

### Region filter

A dropdown between the region panel and the feed narrows both the feed and the account list to any mix of regions (`ArrivalRegionFilter.tsx`, built on the same `DropdownMenu` checkbox menu as the catalogs' `MultiSelectFilter`).
Its trigger names the selection: All regions when none is chosen, the names of one or two, "3 regions" beyond that.
The menu stays open while toggling, explains that selecting a region not read hourly asks for a read, and ends with Clear selection while anything is selected.

It lists every region of the focus status, in its order (`position`), whether or not the region has posts, because a region just put in focus has none until its first read; a region the summary places a shop in that the status does not list follows, and a selected region nothing else lists comes last.
Without a status (the regions RPC absent or failing, or not published yet) it falls back to the regions the account summary uses, by key, without read states.
Each row shows the region's name (`regionName`), the posts its accounts made in the window (the sum of their `recent_count`, 0 when it has no account) and how the run reads it, from the status (`regionReadState` in `arrival-regions.ts`):

- Read hourly: the region is in focus.
- Reading now: a read-once request is pending, which means the read is under way and its posts are still arriving shop by shop (the request is fulfilled only once its shops are delivered).
  It says "Queued for the next run in shop hours, 11:00-20:00 JST" instead only when the read job is not reading the region and it is outside those hours, because the next hourly run is then the only reader.
  Whether the read job is reading it comes from the newest answer to a read-once request this session (`read_run`, migration 000642, kept per region by `useArrivalRegionStatus`): `queued` and `already_running` mean it is; `remote_unsupported` (no host runs the job yet), `manual_unsupported`, `unknown_job`, `error`, or no answer at all (a request from before the page loaded, or a backend before 000642) mean it is not.
  There is no waiting time before it says queued.
- No readable list yet: the region has no list to read, so no read can be asked for.
- Read 3 minutes ago (or Read just now): out of focus, read once before (`last_fulfilled`); Not read yet otherwise.

Selecting regions requests `regions=<key>,<key>` from the posts route, which passes them on as `p_regions`, and reloads the feed from the first page; the window and paging are unchanged.
The account list keeps only the accounts of any selected region, its All row names the selection on its second line, and the feed header reads "All accounts in Akihabara, Fukuoka".
A selected shop outside every selected region is cleared in the same step, so the feed never asks for a shop and regions that exclude each other; Clear selection keeps the shop.
A link naming regions and a shop outside them drops the shop once the summary says where the shop is.

Selecting a region that is out of focus, has no read pending and has a readable list sends the region panel's Read once action (`{action: "request_read", region}`) through the shared status, once: a request in flight is remembered, and an accepted one comes back as pending in the status the RPC answers with, which the panel and the dropdown then both show.
A selection never asks twice while a read is pending, never for a region read hourly or without a list, and never from a link (only an operator's selection asks); deselecting cancels nothing.
A refused request shows on the region's row and beside the feed header, and the status is loaded again.

While any selected region has a read pending, the feed refreshes quietly every 20 seconds (`app/dashboard/arrival-feed-poll.ts`): the status first, then a read-once request again for each selected region the fresh status still shows pending, then the account summary (new accounts appear with their counts) and the newest posts.
Asking again keeps the read going: a request that is pending is not recorded twice, and the backend queues a new read job run only when none is queued or running, so a read that stopped short (on its photo budget, or to leave room for an hourly run) resumes.
It asks only after the fresh status still shows the request pending, because asking for a region whose read has just been fulfilled would record a new request and read the region all over again.
Every answer is a normal one (`already_running` and `remote_unsupported` included) and only updates the read state; a refused call (an HTTP error) stops the asking for that region until it is selected again, while the status keeps being polled.
New posts are merged into the loaded ones newest first (`mergeFreshPosts`), never replacing them: pages loaded with Load more stay, and the refresh follows the cursor from the newest page until it reaches a post already loaded (at most 10 pages), so a burst leaves no gap.
The reader's place is kept: the feed switches browser scroll anchoring off (`overflow-anchor: none`) and puts the first card in view back where it was (`captureScrollAnchor` / `restoreScrollAnchor`), correcting the page for account panels added above and an account panel's own scroll for posts added inside it; a reader at the very top simply sees the new posts.
Polling stops when no selected region has a read pending (the request turns into `last_fulfilled`), when the region is deselected, and after 30 minutes regardless.
It keeps polling while the tab is hidden, because the operator asks for a region and goes back to other work, and refreshes at once when the tab shows again.
Until 2026-11-12 it skipped its ticks while hidden, and an Osaka and Nagoya read that ran while the page sat behind another window showed nothing until Refresh was pressed.
A full reload or Load more that starts meanwhile wins over a refresh, and a failed refresh changes nothing.
Beside the feed header each selected region's read says what it is doing: "Reading Fukuoka…", queued, "Fukuoka read 2 minutes ago" once a read the tab followed is done, or why the request failed.

The region comes from the summary: `parseArrivalSources` keeps a row's `region` only when the backend sends the key, and the filter shows only while some row of the latest loaded summary carries it.
A backend from before the region filter sends no `region` key, so the dropdown is absent, no request carries a region, and a `?region=` link is dropped as soon as the summary loads (the derived fallback, when the summary RPC itself is absent, is treated the same way).
A linked key neither the status nor the summary knows is dropped once both have loaded.
The latest summary with regions is kept while the next one loads, so the dropdown and the narrowed list hold still through a window change or Refresh.
The pure logic is in `app/dashboard/arrival-region-filter.ts` (the rows, the canonical selection, unknown keys, the polling key) and `app/dashboard/arrival-accounts.ts` (`sourcesCarryRegions`, `accountInRegions`, `regionCounts`).

Non-goals: the region filter does not change which regions the hourly run reads (that is the region panel), it never cancels a read, and it never infers a region on the frontend; an account with no region key from the backend appears only under All regions.

### Account identity

Most enrolled shops have no entry in `lib/source-labels.ts`, so `@twitter_handle` is the primary identity everywhere (panel, group headers, cards) and the curated label is a secondary line shown only when one exists (`accountLabel` in `app/dashboard/arrival-accounts.ts`).

### Account panel

The panel is the left column on desktop (sticky) and a collapsible block above the feed on a phone, behind an `aria-expanded` toggle that closes again once an account is chosen.
It lists All accounts first, then every account sorted by `latest_post_at` descending, each as an `aria-pressed` button showing the handle, the label when known, posts in the selected window (labelled with it, "3 in 48 h") and posts in total, with a client-side search over handle, shop id and label.

While the sources RPC is not applied, PostgREST answers `PGRST202` (or Postgres `42883`); the route reports that as 501 with `reason: "rpc-missing"`, and the view derives the same rows from every post it has loaded this session (`deriveArrivalSources`), says so under the list, and keeps working.
Any other panel failure stays non-fatal: the posts feed renders and the panel shows its own small alert with Retry, unless the feed already failed the same way.

### Selection and URL state

The selected shop is a leaf query param, `?shop=<buyer_handle>`, owned by the view through `app/dashboard/url-params.ts` (`replaceState`, no history entry), exactly like a trip's `?tab=`.
`app/dashboard/url-state.ts` reads it only when `view=arrivals` and validates it against the same bound the API route puts on `buyer_handle` (1-100 visible characters); `UrlStateSync` carries it (and `?since=` and `?region=`) across a game switch and drops them when the view changes.
Selecting an account requests `buyer_handle=<shop>` server-side and resets the cursor; the view re-reads its params on `popstate`.
The selected regions are a leaf param the same way, `?region=<key>,<key>` (`ARRIVALS_REGION_PARAM`, `parseRegionsParam` and `formatRegionsParam` in `url-params.ts`), sorted and each once, with the commas left readable (`searchString`); each key is checked against the region key pattern the API route checks (`lib/arrival-region-key.ts`, `^[a-z][a-z0-9_]{0,39}$`, at most 50), malformed ones are dropped, a single key from an older link still reads, and All regions stays out of the URL.

### Time window

A chip group in the feed header offers 24 h, 48 h, 7 days and All; 48 h is the default.
The choice is a leaf query param like the shop, `?since=24h|48h|7d|all` (`ARRIVALS_WINDOW_PARAM` and `parseWindowParam` in `url-params.ts`); the view keeps the default out of the URL and remembers the viewer's choice in localStorage (`arrivals.window`, through `lib/local-storage.ts`).
A link that names a window wins over the remembered choice without overwriting it.

The window's cutoff goes to the posts route as `since` and on to the RPC as `p_since` (inclusive, compared with the same observed time the rows are ordered by), so a page holds only posts inside the window.
The feed still applies the cutoff to the rows it receives (`app/dashboard/arrival-window.ts`): the rows are newest first by observed time (`tweet_created_at`, else `acquired_at`), so dropping those observed before the cutoff is exact, and a page whose last row is older than the cutoff ends the paging as well.

A finite window is loaded whole.
The first page shows as soon as it arrives, and the view then follows the cursor on its own, page after page (100 posts each), behind a visible "Loading every post in the window" status, until the RPC returns a short page or a page crosses the cutoff.
An account's section therefore shows every post it made in the window, not only the ones that happened to fall in the first page.
One run follows at most `MAX_WINDOW_PAGES` (30) pages; past that the feed says the window has more posts than are loaded and offers Load more, which continues for another run.
All has no end to reach, so it never pages on its own: Load more appends one page at a time.
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

### Original text

The backend returns the post's caption with each row as `tweet_text` (migration 000605; absent on older backends, null for posts captured before the caption was kept), and the card shows it in full under the header, as the shop wrote it.
The caption is plain text: React renders it as text nodes, never as HTML, `whitespace-pre-line` keeps the shop's line breaks, and the paragraph is marked `lang="ja"` so CJK glyphs render as Japanese.
X's entity escapes (`&amp;` and the like) are decoded back to characters (`app/dashboard/arrival-text.ts`), and the only markup added is a link, `target="_blank" rel="noreferrer noopener"`, for each `https://t.co/...` short link X puts in the text.
A long caption is clamped to six lines with a Show full text control (`aria-expanded`); whether the clamp hides anything is measured on the rendered card (`scrollHeight` against `clientHeight`, re-checked on resize), because the same 140 Japanese characters fill three lines on a wide card and nine on a narrow one.
A row without a caption renders no text block.

### Grouping

In the All view a Group by account toggle (default on) renders one collapsible section per account, ordered by that account's newest loaded post, each with the same cards newest first; pages that arrive later append into the groups.
Each section is a panel with a bounded height (70% of the viewport on desktop, 60% on a phone) that scrolls on its own, with the account header pinned at its top, so one prolific shop does not push the other accounts off the page; collapsing a section leaves only the header.
The header counts the section's posts: "12 posts" once the window is exhausted, which is every post of the window, and "12 loaded" while pages are still arriving or past the page bound.
Off, the feed is the flat newest-first grid.
The toggle (`arrivals.groupByAccount`) and the collapsed accounts (`arrivals.collapsedAccounts`, a JSON array of `buyer_handle`) persist per viewer in localStorage through `lib/local-storage.ts`, whose reads and writes are wrapped in try/catch so a blocked storage API only loses the preference.

## Operator journey

Open Arrivals from the dashboard navigation.
The feed shows the last 48 hours; pick 24 h, 7 days or All in the header to narrow or widen it, and the choice is remembered.
The All view loads every post of the window grouped by account, the first page at once and the rest behind a loading status; each account is a scrolling panel, so scroll inside it for that shop's posts, collapse it to skip it, or turn Group by account off for one flat list.
Select an account in the panel to see only its posts; the URL updates so the view can be shared or bookmarked, and Show all accounts returns to the full feed.
Open the region dropdown above the feed and tick any regions (Fukuoka and Akihabara, say) to see only their posts and accounts; a region not read hourly is read once as soon as it is ticked, and its posts fill in shop by shop while the row and the feed header say it is reading; Clear selection returns to every region.
Load more posts appends the next composite-cursor page in All, or continues past the page bound in a window.
If a later request fails, the loaded posts and cursor remain visible.
An expired session offers a sign-in link in a new tab and a Continue after signing in action that retries the same cursor.
An administrator refusal explains the required role without a transient Retry action.
Read the post's own caption on the card (Show full text when it is clamped), open an image to see the original media, or Open original post for the full context.
Before a trip, open Show regions, choose Focus until on the destination and pick the last day; the hourly run reads that city from the next run in shop hours through that Tokyo date and then drops it.
For a one-off look at a city, press Read once (or tick it in the region dropdown); the read starts at once (within about a minute while an hourly run is going, which takes it at its next shop), shows as Reading now while its posts arrive shop by shop, and is done once its shops are delivered.

Source-post time and evidence-collection time are labeled separately in Japan Standard Time.
Media use `object-fit: contain` inside bounded previews, through the authenticated image proxy.

## Input and response boundaries

The posts route accepts an optional shop id up to 100 visible characters, a page limit from 1 through 100, an optional composite cursor whose timestamp and key must be supplied together, an optional `since` RFC 3339 timestamp for `p_since`, and optional region keys (`regions=a,b` and the older single `region=a`, each `^[a-z][a-z0-9_]{0,39}$`, at most 50 after duplicates are removed) for `p_regions`; malformed input returns 400 before the RPC call, and the backend's own refusal of an argument (`22023`) returns 400 with its message.
The sources route accepts an optional `since` RFC 3339 timestamp and returns 501 with `reason: "rpc-missing"` while the RPC is absent.
Both return 401 without a session, map the backend administrator refusal to 403, and send `Cache-Control: private, no-store` on success.
The browser parser requires post identity, source identity, timestamps, source URLs, at least one media item, SHA-256 digests, and `unverified: true`, and rejects the response if item identity, JPY price, price side, grade, or condition appears.
It accepts the optional re-post fields when they are well formed (a parseable or null `last_boosted_at`, a non-negative integer `boost_count`, a non-empty or null `via_retweet_of`) and rejects a malformed one; the posts route likewise fails closed on an unreadable `last_boosted_at` in a cursor row.
It accepts the optional caption `tweet_text` when it is a string or null (absent or blank reads as none) and rejects any other type.
It accepts the optional `region` when it is a region key or null (absent reads as null) and rejects anything else.
The sources parser requires both handles, non-negative integer counts and a parseable or null timestamp, and accepts an optional `region` that is a region key or null, keeping the key absent when the backend sends none.
The regions route accepts a region key (`^[a-z][a-z0-9_]{0,39}$`), one of the four actions, and for `set_focus` a `YYYY-MM-DD` date or null; anything else returns 400 before the RPC call, the backend's own refusals (`22023`: an unknown region, a date out of range, a region already in focus or with no readable list) return 400 with the backend's message, and the absent RPCs return 501.
The regions parser requires a Tokyo date for `today`, a known focus source and focus kind, non-negative integer counts with readable lists no more than lists, `YYYY-MM-DD` or null dates, and a request id and time in a pending or fulfilled request.

`app/api/twitter-arrivals/regions/route.test.ts`, `app/dashboard/arrival-regions.test.ts` and `app/dashboard/ArrivalRegionPanel.test.tsx` cover the region route's mapping and refusals, the status parser, a region's read state (read hourly; reading while the read job has it or in shop hours; queued outside shop hours otherwise, at once; no list; idle) and the lenient `read_run` parser, and the panel (statuses, last read, read once and its pending state, focus until with its date bounds, remove, keep, reset, refusals, the absent migration, the unpublished state, retry, Japanese, and the 44 px targets).
`app/api/twitter-arrivals/route.test.ts`, `app/api/twitter-arrivals/sources/route.test.ts`, `app/dashboard/arrival-accounts.test.ts`, `app/dashboard/arrival-window.test.ts`, `app/dashboard/arrival-text.test.ts`, `app/dashboard/url-state.test.ts` and `app/dashboard/ArrivalPostsView.test.tsx` cover these boundaries and the loading, empty, retry, expired-session, forbidden, pagination, deduplication, account list, derived fallback, URL selection, grouping and time-window states (cutoff filtering, the stop-paging rule, paging the window to exhaustion with the page bound and its loading status, the window's empty state with Show all, URL and localStorage round trips), the per-account scroll panel, the caption's plain-text rendering, entity decoding, t.co links and clamp toggle, and the region filter (no dropdown and no region sent for a backend without regions, a stale `?region=` link dropped, every region of the status listed in its order with or without posts, the fallback to the summary's regions, counts and read states, mixing regions with `p_regions` and the narrowed account list, clearing a shop outside the selection, the `?region=` list round trip with an old single key, malformed and unknown keys, and `popstate`, the read-once request sent once and only for an unread region, a refused request, and the dropdown holding still while a summary reloads).
`app/dashboard/arrival-region-filter.test.ts` covers the dropdown's rows, the canonical selection, unknown keys and the polling key; `app/dashboard/arrival-feed-poll.test.ts` covers the merge (new posts above, newest first, re-posts moving up, nothing dropped) and keeping the reader's place in the page and inside an account panel; and the view's fake-timer tests cover the polling itself (every 20 seconds while a selected read is pending, the status first and then the read asked again only while the fresh status shows it pending, never after it is fulfilled, the reading or queued label from the read job's answer in and outside shop hours, a refused call stopping the asking until the region is selected again, merging without losing loaded pages, new accounts appearing, stopping on fulfilment, on deselect and after 30 minutes, and refreshing while the tab is hidden and at once when it shows again).
