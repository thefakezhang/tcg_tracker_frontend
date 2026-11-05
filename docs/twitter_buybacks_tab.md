# Twitter buybacks (Buybacks tab)

Backend issue [#2392](https://github.com/thefakezhang/tcg_tracker/issues/2392), backend migration `000628`.

## Purpose

Shops post their buy prices on X as sheet images, and the backend reads every cell of every sheet.
Before this tab the only way to see what a source was paying, and how current that was, was a one-off page built by hand.
The Buybacks tab, beside Arrivals in the Catalog group, shows every buyback source, how fresh its data is, and its latest buylist.

## Goals

- An overview with one card per source: its X accounts, its most recent buyback tweet in JST with its age, when that tweet was read, the latest sheet's cells by status, its live bids, its auto-accept state, and when the poller last checked each account.
- Freshness at a glance: every source carries a Fresh (under 24 hours), Aging (24 to 72 hours) or Expired (over 72 hours) badge with its age, the summary counts the bands, and a chip group filters the cards by band.
- A source's latest buylist: one row per card and grade at its most recent quote, with the card, set, number and printing, the grade, the yen price, whether it is verified (auto-accepted or approved) or still in review, when it was quoted, a link to every post that carried it, and the card and price crops from the sheet.
- Filters on the buylist: grade, verified or in review, and a search over card name (Japanese or English), set name or code, number and printing; sorts by newest quote, highest price and lowest price.
- One source linkable: `/dashboard?view=buybacks&shop=<source>`.
- Keep working before the backend migration is applied, by saying the overview waits for it.

## Non-goals

- No editing or approving from the tab; review stays in the curation queues.
- No arbitrage figures such as a Card Ladder spread; that is a separate view.
- No sealed buylists and no web buylists (cardcollect.jp); the backend lists Twitter singles only.
- No decisions in the browser: which tweets count, the freshness bands, one row per card and grade, the identical quote posted from two accounts, and the verified price are all the backend's (`docs/twitter_buyback_overview.md` in the backend repository).

## Architecture

The view `TwitterBuybacksView` (slug `buybacks`, sentinel `-23`) loads two private no-store routes.

- `/api/twitter-buybacks` passes the caller's session to `twitter_buyback_sources()` and answers `{ overview }`.
- `/api/twitter-buybacks/buylist?source=<handle>` passes it to `twitter_buyback_buylist(p_source)` and answers `{ buylist }`.
  The source is trimmed and must be 1 to 100 visible characters, the same bound as the Arrivals `buyer_handle`; anything else is 400 before the RPC call, and the backend's own refusal (`22023`) is 400 with its message.

Both routes require the Supabase user session, read no table directly, use no service key, map the backend administrator refusal (`42501` or "requires an administrator") to 403, answer 501 with `reason: "rpc-missing"` while the RPC is absent (`PGRST202` or `42883`), and hide every other failure behind a generic 500.
The shared classification is `app/api/twitter-buybacks/rpc-errors.ts`.

`app/dashboard/twitter-buybacks.ts` holds the types, the parsers, the loaders and the pure view logic.
The parsers fail closed: an unknown freshness band, grade or status, a negative or fractional count, an unparseable time, a non-http link, sheet counts that do not add up to the cells, more live bids than live cards, a verified flag that disagrees with the status, or an in-review price that differs from the read price all reject the response rather than render a guess.
`"UNKNOWN"` card numbers and printings read as no value.
A crop box outside its image, or with no area, is dropped and the row stays.
The loaders resolve `null` on the routes' 501.

## The overview

The summary bar counts the sources and each band, and states the global auto-accept switch with today's promotions against the global cap (the cap day starts at 00:00 UTC, which it names in JST).
The source panel is the left column on desktop (sticky) and a collapsible block on a phone, like the Arrivals account panel: All sources first, then every source in the backend's order (latest tweet first), each with a freshness dot, its accounts, the age of its latest tweet and its live bids, behind a search over the source and its accounts.
Each card shows:

- the latest tweet in JST, its account and a link to it, when it was read, and how many sheets the source posted in 24 and 72 hours;
- the latest sheet's cells by status, in words and as a bar (verified, pending, expired, rejected or sealed);
- live bids and live cards against the buylist's cards;
- auto-accept: not configured, off, or on with today's use against the source's daily cap, and a Fingerprint stale badge when the configuration is on an older classifier fingerprint than the source's newest revisions (Fingerprint current otherwise);
- the poller: when it last checked an active account, and a badge for every account paused, suspended, out of the buyer config, or failing.

## The buylist

Opening a source (the card's Open buylist, or the panel) writes `?shop=<source>` and shows the source's card above its buylist.
The buylist states its window: the tweets of the 72 hours up to the source's latest buyback tweet.
When every row has expired it says so, with the latest tweet's date and age, because a source that stopped posting still shows the buylist it last posted.

Each row has the card crop and the price crop from the shop's sheet, drawn from the public sheet image with `object-fit: none` and the backend's boxes, loaded lazily, and linked to the full sheet; the card's name in the viewer's language with the other below; the set, number and printing (`pokemonVariantLabel`); the price; Auto-accepted, Approved, In review, or Expired unreviewed; the read price beside a verified price an operator corrected; the grade; the quote's freshness and JST time; and a link to every post that carried the quote, newest first.
The filters and sort apply to the loaded rows in the browser, which is exact because the backend returns the whole buylist (Laurier, the largest, held 975 rows on 2026-11-05).
Rows render 100 at a time behind Show more so a long buylist stays light on a phone, and a filter or sort change starts from the top again.

## States

- Loading: a status line in the summary bar and the content area.
- Not deployed: while either RPC is absent the tab says the overview appears once backend migration 000628 is applied.
- Error: an expired session offers a sign-in link and Continue after signing in, an administrator refusal says so without Retry, and any other failure shows its message with Try again; the overview and the buylist fail independently.
- Empty: no source yet; a linked source with no sheets (with Back to all sources); a buylist with no quotes; no row matching the filters (with Clear filters); no source in a freshness band.

Every control is a 44 px target on a phone and compact on a desk.
The page never overflows sideways on a phone: every grid and flex row is `min-w-0`, handles and URLs break, and the rows stack crop, card and price in two columns.

## Tests

`app/api/twitter-buybacks/route.test.ts` and `app/api/twitter-buybacks/buylist/route.test.ts` cover the session requirement, the source bound, the RPC arguments, no-store, and the 403, 501, 400 and 500 mappings.
`app/dashboard/twitter-buybacks.test.ts` covers the parsers (and every fail-closed case above), the search, filters and sorts, the source helpers, the crop arithmetic and the loaders.
`app/dashboard/TwitterBuybacksView.test.tsx` covers the overview cards and their freshness, the summary, the freshness filter and the panel search, the not-deployed, empty, error, forbidden and expired-session states, Japanese, opening a source and the URL, the rows (names, set line, price, verification, corrected price, grade, JST time, both posts of a cross-posted quote, the crops), the filters, sorts and Clear filters, Show more, an expired buylist, an unknown linked source, a failed buylist with retry, Refresh, and the 44 px targets.
`app/dashboard/url-state.test.ts` covers `?view=buybacks&shop=`.
